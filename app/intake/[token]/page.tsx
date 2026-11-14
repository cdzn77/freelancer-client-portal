import { PublicIntake } from "@/components/public-intake";
export default async function Page({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  return <PublicIntake token={(await params).token} />;
}
