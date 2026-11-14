import { Text } from "@react-pdf/renderer";
import { brand } from "../lib/brand";
export function PDFBrand({ width = 126 }: { width?: number }) {
  return <Text style={{ width, fontSize: 15, fontFamily: "Helvetica-Bold", color: "#171717" }}>{brand.name}</Text>;
}
