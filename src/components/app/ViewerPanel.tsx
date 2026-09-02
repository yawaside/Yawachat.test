import { useEffect, useMemo, useState } from "react";
import { getSp } from "../../lib/bridge";
import { PlatformIcon } from "../bits";

function ViewerPanel({ compact = false }: { compact?: boolean }) {
  const sp = getSp();
  const [viewers, setViewers] = useState<{ byPlatform: Record<string, number>; total: number }>({ byPlatform: {}, total: 0 });

  useEffect(() => {
    let mounted = true;
    if (!sp) return;
    sp.onViewers((p) => { if (mounted) setViewers(p); });
    sp.getViewers().then((p) => { if (mounted && p) setViewers(p); }).catch(() => {});
    return () => { mounted = false; };
  }, [sp]);

  const rows = Object.entries(viewers.byPlatform).filter(([, n]) => Number(n) > 0);
  if (rows.length === 0) return null;

  return (
    <div className={`border-t py-2 ${compact ? "px-2" : "px-3"}`} style={{ borderColor: "var(--dw-line)" }}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {rows.map(([plat, n]) => (
            <div key={plat} className="flex items-center gap-2 px-2 py-1 rounded-xl" style={{ background: "rgba(255,255,255,0.02)" }}>
              <div className="grid h-6 w-6 place-items-center rounded-md" style={{ background: "transparent", color: "var(--dw-dim)" }}>
                <PlatformIcon id={plat} size={14} />
              </div>
              <span className="font-mono text-[12px]" style={{ color: "var(--dw-text)" }}>{n}</span>
            </div>
          ))}
        </div>
        <div className="font-mono text-[12px]" style={{ color: "var(--dw-dim)" }}>
          Всего: {viewers.total}
        </div>
      </div>
    </div>
  );
}

export default ViewerPanel;
