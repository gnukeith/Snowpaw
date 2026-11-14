use std::collections::HashMap;
use secret_service::{EncryptionType, Item, SecretService};
use tokio::sync::Mutex;
use zeroize::Zeroizing;
use crate::providers::{Address, Failure, validate_id, validate_key};

// A save replaces all origins for an id. Serialize that sequence with every
// other key operation so concurrent commands cannot leave two saved origins.
static STORE: Mutex<()> = Mutex::const_new(());
const APPLICATION: &str = "dev.snowpaw.app";

fn attributes<'a>(id: &'a str, origin: Option<&'a str>) -> HashMap<&'a str, &'a str> {
    let mut attributes = HashMap::from([("application", APPLICATION), ("connection", id)]);
    if let Some(origin) = origin {
        attributes.insert("origin", origin);
    }
    attributes
}

fn unavailable(error: &secret_service::Error) -> bool {
    fn bus(error: &zbus::Error) -> bool {
        match error {
            zbus::Error::Address(_) | zbus::Error::InterfaceNotFound => true,
            zbus::Error::InputOutput(error) => matches!(error.kind(),
                std::io::ErrorKind::NotFound | std::io::ErrorKind::ConnectionRefused
                | std::io::ErrorKind::ConnectionReset | std::io::ErrorKind::BrokenPipe
                | std::io::ErrorKind::NotConnected),
            zbus::Error::FDO(error) => fdo(error),
            zbus::Error::MethodError(name, _, _) => matches!(name.as_str(),
                "org.freedesktop.DBus.Error.ServiceUnknown"
                | "org.freedesktop.DBus.Error.NameHasNoOwner"
                | "org.freedesktop.DBus.Error.NoServer"
                | "org.freedesktop.DBus.Error.Disconnected"),
            _ => false,
        }
    }
    fn fdo(error: &zbus::fdo::Error) -> bool {
        match error {
            zbus::fdo::Error::ServiceUnknown(_) | zbus::fdo::Error::NameHasNoOwner(_)
            | zbus::fdo::Error::NoServer(_) | zbus::fdo::Error::Disconnected(_) => true,
            zbus::fdo::Error::ZBus(error) => bus(error),
            _ => false,
        }
    }
    match error {
        secret_service::Error::Unavailable => true,
        secret_service::Error::Zbus(error) => bus(error),
        secret_service::Error::ZbusFdo(error) => fdo(error),
        _ => false,
    }
}

fn failure(error: secret_service::Error) -> Failure {
    match error {
        secret_service::Error::Locked | secret_service::Error::Prompt
        | secret_service::Error::PromptDisconnected => Failure::new("locked"),
        secret_service::Error::Zbus(zbus::Error::MethodError(name, _, _))
            if name.as_str() == "org.freedesktop.Secret.Error.IsLocked" => Failure::new("locked"),
        _ => Failure::new("answer"),
    }
}

fn write_failure(error: secret_service::Error) -> Failure {
    if unavailable(&error) { Failure::new("keyring") } else { failure(error) }
}

fn optional<T>(result: Result<T, secret_service::Error>) -> Result<Option<T>, Failure> {
    match result {
        Ok(value) => Ok(Some(value)),
        Err(error) if unavailable(&error) => Ok(None),
        Err(error) => Err(failure(error)),
    }
}

async fn connect() -> Result<SecretService<'static>, secret_service::Error> {
    // An encrypted session keeps the secret out of D-Bus message debug output.
    SecretService::connect(EncryptionType::Dh).await
}

async fn unlock(item: &Item<'_>) -> Result<(), secret_service::Error> {
    if item.is_locked().await? {
        item.unlock().await?;
    }
    item.ensure_unlocked().await
}

async fn remove(service: &SecretService<'_>, id: &str) -> Result<(), secret_service::Error> {
    let found = service.search_items(attributes(id, None)).await?;
    let items: Vec<_> = found.unlocked.into_iter().chain(found.locked).collect();
    // Ask for all needed unlocks before removing anything.
    for item in &items {
        unlock(item).await?;
    }
    for item in items {
        item.delete().await?;
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn key_save(id: String, address: String, key: String) -> Result<(), Failure> {
    let key = Zeroizing::new(key);
    validate_id(&id)?;
    let address = Address::parse(&address)?;
    let key = validate_key(&key)?;
    let _guard = STORE.lock().await;
    let service = connect().await.map_err(write_failure)?;
    let collection = match service.get_default_collection().await {
        Ok(collection) => collection,
        Err(secret_service::Error::NoResult) => service.create_collection("Snowpaw", "default")
            .await.map_err(write_failure)?,
        Err(error) => return Err(write_failure(error)),
    };
    if collection.is_locked().await.map_err(write_failure)? {
        collection.unlock().await.map_err(write_failure)?;
    }
    collection.ensure_unlocked().await.map_err(write_failure)?;
    remove(&service, &id).await.map_err(write_failure)?;
    collection.create_item(
        &format!("Snowpaw: {}", address.host()), attributes(&id, Some(&address.origin())),
        key.as_bytes(), true, "text/plain",
    ).await.map_err(write_failure)?;
    Ok(())
}

#[tauri::command]
pub(crate) async fn key_exists(id: String, address: String) -> Result<bool, Failure> {
    validate_id(&id)?;
    let address = Address::parse(&address)?;
    let _guard = STORE.lock().await;
    let Some(service) = optional(connect().await)? else { return Ok(false) };
    // Search at service level includes locked items and never executes a prompt.
    let Some(found) = optional(service.search_items(attributes(&id, Some(&address.origin()))).await)?
        else { return Ok(false) };
    Ok(!found.unlocked.is_empty() || !found.locked.is_empty())
}

#[tauri::command]
pub(crate) async fn key_forget(id: String) -> Result<(), Failure> {
    validate_id(&id)?;
    let _guard = STORE.lock().await;
    remove(&connect().await.map_err(write_failure)?, &id).await.map_err(write_failure)
}

pub(crate) async fn lookup(id: &str, origin: &str) -> Result<Option<Zeroizing<String>>, Failure> {
    let _guard = STORE.lock().await;
    let Some(service) = optional(connect().await)? else { return Ok(None) };
    let Some(found) = optional(service.search_items(attributes(id, Some(origin))).await)?
        else { return Ok(None) };
    let Some(item) = found.unlocked.first().or_else(|| found.locked.first()) else {
        return Ok(None);
    };
    if optional(unlock(item).await)?.is_none() { return Ok(None); }
    let Some(bytes) = optional(item.get_secret().await)? else { return Ok(None) };
    let bytes = Zeroizing::new(bytes);
    let text = std::str::from_utf8(&bytes).map_err(|_| Failure::new("address"))?;
    Ok(Some(Zeroizing::new(validate_key(text)?.to_owned())))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn attributes_bind_an_id_to_exactly_one_origin() {
        let attrs = attributes("connection-1", Some("https://example.com"));
        assert_eq!(attrs.get("application"), Some(&APPLICATION));
        assert_eq!(attrs.get("connection"), Some(&"connection-1"));
        assert_eq!(attrs.get("origin"), Some(&"https://example.com"));
        assert!(!attributes("connection-1", None).contains_key("origin"));
        assert_ne!(attrs, attributes("connection-2", Some("https://example.com")));
        assert_ne!(attrs, attributes("connection-1", Some("http://example.com")));
    }

    #[test]
    fn absent_service_is_optional_but_lock_and_other_failures_are_not() {
        for error in [secret_service::Error::Unavailable,
            secret_service::Error::ZbusFdo(zbus::fdo::Error::ServiceUnknown(String::new())),
            secret_service::Error::ZbusFdo(zbus::fdo::Error::NameHasNoOwner(String::new())),
            secret_service::Error::Zbus(std::io::Error::from(std::io::ErrorKind::ConnectionRefused).into())]
        {
            assert!(unavailable(&error));
            assert_eq!(optional::<()>(Err(error)), Ok(None));
        }
        assert_eq!(write_failure(secret_service::Error::Unavailable), Failure::new("keyring"));
        assert_eq!(optional::<()>(Err(secret_service::Error::Locked)), Err(Failure::new("locked")));
        assert_eq!(optional::<()>(Err(secret_service::Error::Prompt)), Err(Failure::new("locked")));
        assert_eq!(optional::<()>(Err(secret_service::Error::Crypto("private detail"))),
            Err(Failure::new("answer")));
    }

    #[test]
    #[ignore = "manual check: saves and removes a throwaway key in the desktop keyring"]
    fn manual_secret_service() {
        tauri::async_runtime::block_on(async {
            let id = format!("astra-test-{}-{}", std::process::id(),
                std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs());
            let address = "https://example.invalid/v1";
            let other = "https://other.invalid/v1";
            let key = Zeroizing::new(format!("throwaway-{}", id));
            let result = async {
                key_save(id.clone(), address.into(), key.to_string()).await?;
                if !key_exists(id.clone(), address.into()).await?
                    || key_exists(id.clone(), other.into()).await?
                    || lookup(&id, "https://example.invalid").await?
                        .is_none_or(|found| found.as_str() != key.as_str())
                {
                    return Err(Failure::new("answer"));
                }
                // Replacing at a different origin must remove the former binding.
                key_save(id.clone(), other.into(), key.to_string()).await?;
                if key_exists(id.clone(), address.into()).await?
                    || !key_exists(id.clone(), other.into()).await?
                {
                    return Err(Failure::new("answer"));
                }
                Ok(())
            }.await;
            // Clean up before reporting a failure so even a failed check leaves no key.
            let cleanup = key_forget(id.clone()).await;
            assert_eq!(cleanup, Ok(()), "throwaway cleanup failed");
            assert_eq!(result, Ok(()), "throwaway save/find/replace failed");
            assert_eq!(key_exists(id.clone(), other.into()).await, Ok(false));
            assert_eq!(key_forget(id).await, Ok(()));
            println!("Throwaway key saved, found, replaced across origins, and forgotten; second forget succeeded.");
        });
    }
}
