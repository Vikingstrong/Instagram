import type { IconProps } from "@/components/icons/ig-icons";
import { DefaultAvatar } from "@/components/ui-ig/avatar";

export function ProfileNavIcon({ active }: IconProps) {
  return <DefaultAvatar size={24} active={active} />;
}
