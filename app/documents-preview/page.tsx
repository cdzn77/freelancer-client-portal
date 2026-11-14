import { notFound } from "next/navigation";
import { DocumentsPreview } from "@/components/documents-preview";
export default function Preview() {
  if (process.env.NODE_ENV === "production") notFound();
  return <DocumentsPreview />;
}
