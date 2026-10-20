import { cn } from "@/lib/utils";

const META: Record<string, { label: string; color: string; title: string }> = {
  mysql: { label: "My", color: "#0b7a99", title: "MySQL" },
  mariadb: { label: "Ma", color: "#a13d63", title: "MariaDB" },
  tidb: { label: "Ti", color: "#d61f3c", title: "TiDB" },
  oceanbase: { label: "OB", color: "#2563eb", title: "OceanBase" },
  percona: { label: "Pc", color: "#0f766e", title: "Percona Server" },
};

export function DbFlavorIcon({
  flavor,
  version,
  size = 16,
  className,
}: {
  flavor?: string;
  version?: string;
  size?: number;
  className?: string;
}) {
  const meta = META[(flavor ?? "mysql").toLowerCase()] ?? META.mysql;
  return (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white", className)}
      style={{ width: size, height: size, fontSize: Math.max(7, size * 0.42), backgroundColor: meta.color }}
      title={`${meta.title}${version ? ` ${version}` : ""}`}
      aria-label={meta.title}
    >
      {meta.label}
    </span>
  );
}
