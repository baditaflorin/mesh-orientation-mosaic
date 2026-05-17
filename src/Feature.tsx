import { useEffect, useRef, useState } from "react";
import { useTilt, type MeshConfig, type YRoom } from "@baditaflorin/mesh-common";

type Props = { room: YRoom | null; config: MeshConfig };

type Peer = {
  /** Hue 0-359 the peer is supposed to be showing when correctly oriented. */
  targetHue: number;
  /** Current yaw in degrees (compass; 0=N, 90=E). */
  yaw: number;
  /** Current pitch in degrees (rotation around X; 0=flat). */
  pitch: number;
  /** When >0.85, peer is considered "on target". */
  match: number;
  name: string;
  armed: boolean;
};

const NAME_KEY = (prefix: string) => `${prefix}:displayName`;

function pickTargetHue(peerId: string): number {
  // Deterministic per-peer target so phones don't all want the same angle.
  let h = 0;
  for (let i = 0; i < peerId.length; i++) h = (h * 31 + peerId.charCodeAt(i)) >>> 0;
  return h % 360;
}

function targetYawFor(hue: number): number {
  // Map hue back to a target yaw (0-360). Each peer aims at a different cardinal slice.
  return hue;
}

export function Feature({ room, config }: Props) {
  if (!room) {
    return (
      <div className="om-screen">
        <h1>orientation mosaic</h1>
        <p className="om-status">Connecting…</p>
      </div>
    );
  }
  return <Body room={room} config={config} />;
}

function Body({ room, config }: { room: YRoom; config: MeshConfig }) {
  const [name, setName] = useState(
    () => localStorage.getItem(NAME_KEY(config.storagePrefix)) ?? "",
  );
  const [armed, setArmed] = useState(false);
  const tilt = useTilt({ armed });
  const permError = tilt.error;
  const myYaw = armed ? ((tilt.alpha ?? 0) + 360) % 360 : 0;
  const myPitch = armed ? (tilt.beta ?? 0) : 0;
  const [, rerender] = useState(0);
  const lastPubRef = useRef(0);

  useEffect(() => {
    if (name) localStorage.setItem(NAME_KEY(config.storagePrefix), name);
  }, [name, config.storagePrefix]);

  useEffect(() => {
    const yPeers = room.doc.getMap<Peer>("peers");
    const onChange = () => rerender((n) => n + 1);
    yPeers.observe(onChange);
    return () => yPeers.unobserve(onChange);
  }, [room]);

  // Compute target hue deterministically from peer ID
  const targetHue = pickTargetHue(room.peerId);
  const targetYaw = targetYawFor(targetHue);

  // Publish my off-state reading whenever name or armed changes so other
  // peers always see my latest name even before I tap "arm".
  useEffect(() => {
    if (armed) return;
    const myName = name.trim() || `peer-${room.peerId.slice(0, 4)}`;
    room.doc.getMap<Peer>("peers").set(room.peerId, {
      targetHue,
      yaw: 0,
      pitch: 0,
      match: 0,
      name: myName,
      armed: false,
    });
  }, [armed, name, room, targetHue]);

  useEffect(() => {
    if (!armed) return;
    const now = performance.now();
    if (now - lastPubRef.current <= 200) return;
    // Match score: 1 when yaw delta and pitch are aligned; falls off with angular error.
    const yawErr = Math.min(Math.abs(myYaw - targetYaw), 360 - Math.abs(myYaw - targetYaw));
    const yawScore = Math.max(0, 1 - yawErr / 30); // tight ±30°
    const pitchScore = Math.max(0, 1 - Math.abs(myPitch) / 30); // flat target
    const match = yawScore * pitchScore;
    const myName = name.trim() || `peer-${room.peerId.slice(0, 4)}`;
    room.doc.getMap<Peer>("peers").set(room.peerId, {
      targetHue,
      yaw: Math.round(myYaw),
      pitch: Math.round(myPitch),
      match,
      name: myName,
      armed: true,
    });
    lastPubRef.current = now;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [armed, myYaw, myPitch, targetHue, targetYaw]);

  const peers: Array<{ id: string; p: Peer }> = [];
  room.doc.getMap<Peer>("peers").forEach((p, id) => peers.push({ id, p }));
  const armedPeers = peers.filter((x) => x.p.armed);
  const onTarget = armedPeers.filter((x) => x.p.match >= 0.85).length;
  const allAligned = armedPeers.length > 0 && onTarget === armedPeers.length;

  // The visible color is derived from my current yaw vs target.
  const myYawErr = Math.min(Math.abs(myYaw - targetYaw), 360 - Math.abs(myYaw - targetYaw));
  const myMatch = armed
    ? Math.max(0, 1 - myYawErr / 30) * Math.max(0, 1 - Math.abs(myPitch) / 30)
    : 0;
  // Color intensity grows with match
  const myBg = armed ? `hsl(${targetHue} 70% ${20 + Math.round(myMatch * 40)}%)` : "var(--mesh-bg)";

  return (
    <div
      className="om-screen"
      style={{ background: myBg }}
      data-all-aligned={allAligned ? "1" : "0"}
    >
      <header className="om-header">
        <h1>orientation mosaic</h1>
        <input
          className="om-name"
          placeholder="your name (optional)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={32}
        />
      </header>

      {!armed && (
        <>
          <button type="button" className="om-arm" onClick={() => setArmed(true)}>
            arm orientation
          </button>
          {permError && <p className="om-error">{permError}</p>}
          <p className="om-help">
            Each phone is assigned a target compass heading. Hold your phone flat and rotate until
            its color is brightest. When every phone is on target, the room glows.
          </p>
        </>
      )}

      {armed && (
        <>
          <div className="om-readout">
            <p>
              target yaw: <strong>{targetYaw}°</strong>
            </p>
            <p>
              you: yaw <strong>{Math.round(myYaw)}°</strong>, pitch{" "}
              <strong>{Math.round(myPitch)}°</strong>
            </p>
            <p>
              match: <strong>{(myMatch * 100).toFixed(0)}%</strong>
            </p>
          </div>
          <button type="button" className="om-disarm" onClick={() => setArmed(false)}>
            disarm
          </button>
        </>
      )}

      <div className="om-group">
        <p>
          on target: {onTarget}/{armedPeers.length}
          {allAligned && " · 🌈 ALIGNED"}
        </p>
        <ul className="om-list">
          {peers.map(({ id, p }) => (
            <li
              key={id}
              className={p.match >= 0.85 ? "is-aligned" : p.armed ? "is-armed" : "is-idle"}
              style={
                {
                  "--peer-hue": `${p.targetHue}`,
                  "--peer-l": `${p.armed ? 25 + Math.round(p.match * 40) : 15}%`,
                } as React.CSSProperties
              }
            >
              <span className="om-peer-dot" />
              <span className="om-peer-name">{p.name}</span>
              <span className="om-peer-meta">
                {p.armed ? `${Math.round(p.match * 100)}%` : "—"}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
