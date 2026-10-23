import { AppShell } from "@/components/shell/app-shell";
import { HomeAccess } from "@/features/auth/home-access";
import { CoinWalletView } from "@/features/coins/coin-wallet";

export default function CoinsPage() {
  return (
    <HomeAccess>
      <AppShell>
        <CoinWalletView />
      </AppShell>
    </HomeAccess>
  );
}
