import { Frame } from "../../components/Frame";
import type { BlockProps } from "../types";

export default function Diagram({ source }: BlockProps) {
  return <Frame entry="diagram" source={source} title="Mermaid diagram" />;
}
