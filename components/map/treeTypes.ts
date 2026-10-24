import type { AvatarId } from "@/lib/room/avatars";
import type { TreePoint } from "@/lib/map/tree";

export interface TreeNode {
  key: string;
  kind: "memory" | "product" | "sprout";
  title: string;
  detail: string;
  byline: string;
  avatar: AvatarId;
  position: TreePoint;
  active?: boolean;
  dimmed?: boolean;
  busy?: boolean;
  pulled?: boolean;
  parentKey?: string;
}
export interface MemoryTreeSceneProps {
  nodes: TreeNode[];
  recipient: string;
  giftTitle?: string;
  giftDetail?: string;
  approved: boolean;
  reducedMotion: boolean;
  onPick(key: string): void;
  onChoose(listingId: string): void;
  onConstraint(listingId: string, reason: "owned" | "price"): void;
}
