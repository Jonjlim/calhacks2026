"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import { Suspense, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { StorybookAvatar } from "@/components/characters/StorybookAvatar";
import { JUNCTION, ROOT, type TreePoint } from "@/lib/map/tree";
import type { MemoryTreeSceneProps, TreeNode } from "./treeTypes";
import s from "./memory-tree.module.css";

function Tree({ at = [0, 0, 0], scale = 1 }: { at?: TreePoint; scale?: number }) {
  return <group position={at} scale={scale}><mesh position={[0, .35, 0]}><cylinderGeometry args={[.045, .08, .7, 6]} /><meshToonMaterial color="#89705b" /></mesh>{[[0, .85, 0], [.14, 1.04, .03], [-.16, 1.02, -.02]].map((p, i) => <mesh key={i} position={p as TreePoint}><icosahedronGeometry args={[.32, 1]} /><meshToonMaterial color="#8ca877" /></mesh>)}</group>;
}
function Island({ at, children, root = false, dimmed = false, active = false, reduce, onPick }: { at: TreePoint; children: React.ReactNode; root?: boolean; dimmed?: boolean; active?: boolean; reduce: boolean; onPick(): void }) {
  const ref = useRef<THREE.Group>(null);
  const initial = useRef(at);
  const radius = root ? 1.65 : 1;
  const target = useMemo(() => new THREE.Vector3(...at), [at[0], at[1], at[2]]);
  useFrame((_, dt) => {
    if (!ref.current || reduce) return;
    ref.current.position.lerp(target, 1 - Math.exp(-dt * 5));
    ref.current.scale.lerp(new THREE.Vector3(1, 1, 1), 1 - Math.exp(-dt * 5));
  });
  return <group ref={ref} position={reduce ? at : initial.current} scale={reduce ? 1 : .1} onClick={e => { e.stopPropagation(); onPick(); }}>
    <mesh position={[0, -.35, 0]} castShadow><cylinderGeometry args={[radius * .95, radius * .65, .7, 7]} /><meshToonMaterial color={dimmed ? "#777083" : "#ad8f8b"} /></mesh>
    <mesh position={[0, -.95, 0]} rotation={[0, .2, Math.PI]}><coneGeometry args={[radius * .67, 1, 7]} /><meshToonMaterial color="#8f7992" /></mesh>
    <mesh position={[0, -.04, 0]} receiveShadow><cylinderGeometry args={[radius, radius * .95, .22, 9]} /><meshToonMaterial color={dimmed ? "#8b8a93" : "#8fa471"} /></mesh>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, .08, 0]}><circleGeometry args={[radius * .7, 9]} /><meshToonMaterial color={dimmed ? "#9b98a2" : "#c5ba91"} /></mesh>
    <Tree at={[-radius * .7, .04, -radius * .4]} scale={radius * .65} />
    {active && <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, .09, 0]}><ringGeometry args={[radius * .94, radius, 40]} /><meshBasicMaterial color="#eed3a0" /></mesh>}
    {children}
  </group>;
}
function Branch({ from, to, muted, warm, reduce }: { from: TreePoint; to: TreePoint; muted?: boolean; warm?: boolean; reduce: boolean }) {
  const progress = useRef(0);
  const particle = useRef<THREE.Mesh>(null);
  const curve = useMemo(() => new THREE.CatmullRomCurve3([new THREE.Vector3(...from), new THREE.Vector3((from[0] + to[0]) / 2, Math.min(from[1], to[1]) - .6, (from[2] + to[2]) / 2), new THREE.Vector3(...to)]), [from[0], from[1], from[2], to[0], to[1], to[2]]);
  const geometry = useMemo(() => new THREE.TubeGeometry(curve, 50, warm ? .045 : .028, 6, false), [curve, warm]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useFrame(({ clock }, dt) => {
    progress.current = Math.min(1, progress.current + dt * 1.6);
    geometry.setDrawRange(0, Math.floor((reduce ? 1 : progress.current) * 50) * 36);
    if (particle.current) particle.current.position.copy(curve.getPoint((clock.elapsedTime * .15) % 1));
  });
  return <group><mesh geometry={geometry}><meshStandardMaterial color={muted ? "#77738d" : warm ? "#ecc58f" : "#c7b28c"} emissive="#766256" emissiveIntensity={.3} transparent opacity={muted ? .2 : .75} /></mesh>{!reduce && !muted && <mesh ref={particle}><sphereGeometry args={[.045, 8, 8]} /><meshBasicMaterial color="#ffe7b5" /></mesh>}</group>;
}
function Present({ approved }: { approved: boolean }) {
  return <group position={[.2, .08, 0]}><mesh position={[0, .38, 0]}><boxGeometry args={[.9, .75, .8]} /><meshToonMaterial color="#f0e3c9" /></mesh><group position={[0, approved ? .78 : .95, 0]}><mesh><boxGeometry args={[1, .13, .9]} /><meshToonMaterial color="#f5e8d2" /></mesh>{[-1, 1].map(i => <mesh key={i} position={[i * .17, .16, 0]} rotation={[Math.PI / 2, 0, i * .35]} scale={[1, .65, 1]}><torusGeometry args={[.18, .045, 7, 16]} /><meshToonMaterial color="#cf9788" /></mesh>)}</group><mesh position={[0, .4, .01]}><boxGeometry args={[.13, .8, .84]} /><meshToonMaterial color="#c99181" /></mesh></group>;
}
const stop = (e: React.SyntheticEvent) => e.stopPropagation();
function Label({ node, onPick, onConstraint }: { node: TreeNode; onPick(): void; onConstraint: MemoryTreeSceneProps["onConstraint"] }) {
  return <Html position={[0, -1.1, 1.1]} center zIndexRange={[30, 0]}><button className={`${s.nodeLabel} ${node.dimmed ? s.dimmed : ""} ${node.active ? s.activeNode : ""}`} onPointerDown={stop} onPointerUp={stop} onClick={e => { e.stopPropagation(); onPick(); }} draggable={node.kind === "product" && !node.dimmed} onDragStart={e => { if (node.kind === "product") e.dataTransfer.setData("application/unwrap-gift", node.key.slice(8)); }} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); e.stopPropagation(); const reason = e.dataTransfer.getData("application/unwrap-constraint"); if (node.kind === "product" && (reason === "owned" || reason === "price")) onConstraint(node.key.slice(8), reason); }}>
    <span>{node.byline}</span><strong>{node.title}</strong><small>{node.busy ? "Growing ideas…" : node.detail}</small>
  </button></Html>;
}
export default function MemoryTreeScene(props: MemoryTreeSceneProps) {
  const { nodes, reducedMotion: reduce } = props;
  return <Canvas shadows frameloop={reduce ? "demand" : "always"} dpr={[1, 1.5]} camera={{ position: [0, 6.2, 16], fov: 43, near: .1, far: 100 }} gl={{ antialias: true }} aria-label="Floating memory islands and gift branches">
    <ambientLight intensity={.9} /><hemisphereLight args={["#e3dced", "#756681", .85]} /><directionalLight position={[-5, 12, 8]} intensity={2.2} color="#ffdfb4" castShadow /><directionalLight position={[7, 4, -6]} intensity={1.2} color="#aaa9e3" />
    <Suspense fallback={<Html center><p className={s.loading}>The little friends are arriving…</p></Html>}>
      <Branch from={ROOT} to={JUNCTION} warm reduce={reduce} />
      {nodes.map(node => { const parent = nodes.find(n => n.key === node.parentKey)?.position ?? JUNCTION; return <group key={node.key}><Branch from={parent} to={node.position} muted={node.dimmed} warm={node.pulled} reduce={reduce} /><Island at={node.position} dimmed={node.dimmed} active={node.active} reduce={reduce} onPick={() => props.onPick(node.key)}>
        <StorybookAvatar avatar={node.avatar} clip={node.busy ? "Wave" : "Idle"} scale={node.kind === "memory" ? .5 : .35} position={[node.kind === "memory" ? .2 : -.4, .08, 0]} timeScale={reduce ? 0 : 1} />
        {node.kind !== "memory" && <mesh position={[.3, .4, 0]} rotation={[0, .2, 0]}><boxGeometry args={node.kind === "sprout" ? [.55, .6, .07] : [.6, .55, .5]} /><meshToonMaterial color={node.kind === "sprout" ? "#ddd9b1" : "#d3b18d"} /></mesh>}
        <Label node={node} onPick={() => props.onPick(node.key)} onConstraint={props.onConstraint} />
      </Island></group>; })}
      <Island at={ROOT} root active={!!props.giftTitle} reduce={reduce} onPick={() => props.onPick("box:main")}><Present approved={props.approved} /><StorybookAvatar avatar="curious" position={[-.9, .08, .05]} scale={.5} clip={props.approved ? "Celebrate" : "Idle"} timeScale={reduce ? 0 : 1} /><Tree at={[.8, .08, -.7]} scale={1.3} /><Html position={[0, -.9, 1.5]} center zIndexRange={[30, 0]}><button className={`${s.nodeLabel} ${s.rootLabel}`} onPointerDown={stop} onPointerUp={stop} onClick={e => { e.stopPropagation(); props.onPick("box:main"); }} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); e.stopPropagation(); const listing = e.dataTransfer.getData("application/unwrap-gift"); if (listing) props.onChoose(listing); }}><span>{props.approved ? "EVERYONE APPROVED" : "THE GIFT ISLAND"}</span><strong>{props.giftTitle ?? `A little world for ${props.recipient}`}</strong><small>{props.giftDetail ?? "Choose a gift, together."}</small></button></Html></Island>
      <OrbitControls enablePan={false} minDistance={13} maxDistance={23} minPolarAngle={.85} maxPolarAngle={1.35} minAzimuthAngle={-.3} maxAzimuthAngle={.3} target={[0, .4, 0]} />
    </Suspense>
  </Canvas>;
}
