import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { BlockProps } from "../types.ts";
import { parseSpec } from "./spec.ts";
import type { Point } from "./spec.ts";
import { finite, formatNumber, paths, position, preparePlot, ticks } from "./scale.ts";
import styles from "./Plot.module.css";

const colours = [styles.series1, styles.series2, styles.series3, styles.series4, styles.series5, styles.series6];
/* The drawing is laid out in the pixels it is shown at, so that its text is
   drawn at the size the stylesheet gives it instead of being scaled with the
   picture. These are the room left round the plotted area for tick labels
   and axis names, in those pixels. The left side also grows with the longest
   number on the vertical axis, at about the width of a figure in small text. */
const margin = { left: 32, top: 12, right: 16, bottom: 44 };
const figureWidth = 7;
/** Width to height. */
const aspect = 8 / 5;

export default function Plot({ source }: BlockProps) {
  const clipId = `plot-${useId()}`;
  const canvas = useRef<SVGSVGElement>(null);
  // Until it has been measured, a width near that of a message.
  const [width, setWidth] = useState(400);

  useLayoutEffect(() => {
    const svg = canvas.current;
    if (!svg) return;
    const measure = () => setWidth(Math.max(margin.left + margin.right + 40, Math.round(svg.getBoundingClientRect().width)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(svg);
    return () => observer.disconnect();
  }, []);

  const { spec, samples, y } = useMemo(() => {
    const spec = parseSpec(source);
    return { spec, ...preparePlot(spec) };
  }, [source]);
  const height = Math.round(width / aspect);
  const yLabels = useMemo(() => {
    const span = y[1] - y[0];
    return ticks(y).map((value) => ({ value, text: formatNumber(value, span) }));
  }, [y]);
  const left = margin.left + figureWidth * Math.max(1, ...yLabels.map((label) => label.text.length));
  const frame = {
    left,
    top: margin.top,
    width: Math.max(1, width - left - margin.right),
    height: Math.max(1, height - margin.top - margin.bottom),
  };
  const project = ([x, value]: Point): Point => [
    frame.left + position(x, spec.x) * frame.width,
    frame.top + (1 - position(value, y)) * frame.height,
  ];
  const xTicks = ticks(spec.x);
  const bottom = frame.top + frame.height;
  const right = frame.left + frame.width;
  const xSpan = spec.x[1] - spec.x[0];
  const subjects = spec.series.map((s) => s.kind === "curve" ? s.formula : s.label).join(" and ");
  const description = `${spec.title ? `${spec.title}. ` : ""}Plot of ${subjects} for x from ${formatNumber(spec.x[0], xSpan)} to ${formatNumber(spec.x[1], xSpan)}`;
  const legend = spec.series.length > 1 || spec.series.some((s) => s.named);

  return (
    <figure className={styles.plot}>
      {spec.title && <figcaption className={styles.heading}>{spec.title}</figcaption>}
      <svg ref={canvas} className={styles.canvas} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={description}>
        <title>{description}</title>
        <defs>
          <clipPath id={clipId}>
            <rect x={frame.left} y={frame.top} width={frame.width} height={frame.height} />
          </clipPath>
        </defs>
        <rect className={styles.frame} x={frame.left} y={frame.top} width={frame.width} height={frame.height} />
        {xTicks.map((value) => {
          const x = project([value, y[0]])[0];
          return (
            <g key={value}>
              <line className={styles.grid} x1={x} y1={frame.top} x2={x} y2={bottom} />
              <line className={styles.axis} x1={x} y1={bottom} x2={x} y2={bottom + 4} />
              <text className={styles.xTick} x={x} y={bottom + 18}>{formatNumber(value, xSpan)}</text>
            </g>
          );
        })}
        {yLabels.map(({ value, text }) => {
          const y = project([spec.x[0], value])[1];
          return (
            <g key={value}>
              <line className={styles.grid} x1={frame.left} y1={y} x2={right} y2={y} />
              <line className={styles.axis} x1={frame.left - 4} y1={y} x2={frame.left} y2={y} />
              <text className={styles.yTick} x={frame.left - 8} y={y}>{text}</text>
            </g>
          );
        })}
        <path className={styles.axis} d={`M${frame.left},${frame.top}V${bottom}H${right}`} />
        {spec.x[0] <= 0 && spec.x[1] >= 0 && (
          <line className={styles.zero} x1={project([0, 0])[0]} x2={project([0, 0])[0]} y1={frame.top} y2={bottom} />
        )}
        {y[0] <= 0 && y[1] >= 0 && (
          <line className={styles.zero} x1={frame.left} x2={right} y1={project([0, 0])[1]} y2={project([0, 0])[1]} />
        )}
        <g clipPath={`url(#${clipId})`}>
          {samples.map((sample, index) => (
            <g key={index} className={colours[index % colours.length]}>
              {sample.series.kind !== "points" && paths(sample, spec.x, y, project).map((d, piece) => (
                <path key={piece} className={styles.curve} d={d} />
              ))}
              {(sample.series.kind === "points" || sample.series.kind === "line") && sample.points.filter((p) =>
                finite(p) && p[0] >= spec.x[0] && p[0] <= spec.x[1] && p[1] >= y[0] && p[1] <= y[1],
              ).map((point, index) => {
                const [cx, cy] = project(point);
                return <circle key={index} className={styles.point} cx={cx} cy={cy} />;
              })}
            </g>
          ))}
        </g>
        <text className={styles.xLabel} x={frame.left + frame.width / 2} y={height - 6}>{spec.xlabel ?? "x"}</text>
        <text className={styles.yLabel} transform={`translate(12 ${frame.top + frame.height / 2}) rotate(-90)`}>{spec.ylabel ?? "y"}</text>
      </svg>
      {legend && (
        <ul className={styles.legend} aria-label="Plot legend">
          {spec.series.map((series, index) => (
            <li key={index} className={styles.legendItem}>
              <span className={`${styles.swatch} ${colours[index % colours.length]}`} aria-hidden="true" />
              <span>{series.label}</span>
            </li>
          ))}
        </ul>
      )}
    </figure>
  );
}
