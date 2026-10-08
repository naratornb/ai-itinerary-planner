import { MarketplaceBookingScreen } from "../../../../../components/marketplace-booking-screen";
import { MarketplaceRouteNav } from "../../../../../components/route-screens";

export default async function MarketplaceBookPage({
  params,
}: {
  params: Promise<{ packageId: string }>;
}) {
  const { packageId } = await params;
  return <><MarketplaceRouteNav /><MarketplaceBookingScreen packageId={packageId} /></>;
}
