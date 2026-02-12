import { cn } from "@/lib/utils";

function hueFromString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 360;
}

export function ProfileAvatar(props: {
  name: string;
  src: string | null;
  position?: { x: number; y: number } | null;
  sizePx?: number;
  className?: string;
  title?: string;
}) {
  const sizePx = props.sizePx ?? 24;
  const position = props.position ?? { x: 50, y: 50 };
  const title = props.title ?? props.name;

  if (props.src) {
    return (
      <div
        className={cn(
          "aspect-square shrink-0 overflow-hidden rounded-full bg-muted",
          props.className
        )}
        style={{ width: sizePx, height: sizePx }}
        title={title}
      >
        <img
          alt={props.name}
          className="h-full w-full object-cover"
          decoding="async"
          draggable={false}
          loading="lazy"
          src={props.src}
          style={{ objectPosition: `${position.x}% ${position.y}%` }}
        />
      </div>
    );
  }

  const trimmed = String(props.name ?? "").trim();
  const initial = trimmed ? trimmed[0]!.toUpperCase() : "?";
  const hue = hueFromString(trimmed || "?");

  return (
    <div
      className={cn(
        "inline-flex aspect-square shrink-0 select-none items-center justify-center rounded-full text-[0.82em] font-medium text-white",
        props.className
      )}
      style={{
        width: sizePx,
        height: sizePx,
        backgroundColor: `hsl(${hue} 70% 45%)`,
      }}
      title={title}
    >
      {initial}
    </div>
  );
}
