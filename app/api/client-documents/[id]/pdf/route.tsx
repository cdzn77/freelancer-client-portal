import { renderToBuffer } from "@react-pdf/renderer";
import { ClientDocumentPDF } from "@/components/client-document-pdf";
import { requestClient } from "@/lib/server";
import { type ClientDocument } from "@/lib/client-documents";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const db = await requestClient(request);
    const { data, error } = await db
      .from("client_documents")
      .select("*")
      .eq("id", (await params).id)
      .single();
    if (error || !data)
      return Response.json({ error: "Document unavailable." }, { status: 404 });
    const d = data as ClientDocument;
    const buffer = await renderToBuffer(<ClientDocumentPDF document={d} />);
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${d.kind.replaceAll(" ", "-")}-v${d.version}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Client document PDF export failed:", error instanceof Error ? error.message : "Unknown error");
    return Response.json(
      { error: "Unable to download this document." },
      { status: 400 },
    );
  }
}
