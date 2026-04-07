import { jsx as _jsx } from "react/jsx-runtime";
import { useEffect, useRef } from "react";
import { createRenderer } from "./renderer";
export function CanvasRenderer({ store }) {
    const ref = useRef(null);
    useEffect(() => {
        if (!ref.current)
            return;
        const r = createRenderer(ref.current, store);
        return () => r.destroy();
    }, [store]);
    return _jsx("div", { ref: ref, style: { width: "100%", height: "100%" } });
}
