import { env } from "cloudflare:workers";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "An image file is required" }, { status: 400 });
  }
  if (!file.type.startsWith("image/") || file.size > 12 * 1024 * 1024) {
    return Response.json({ error: "Choose an image smaller than 12 MB" }, { status: 400 });
  }

  const key = `${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "-")}`;
  await env.MEDIA.put(key, file.stream(), {
    httpMetadata: { contentType: file.type },
    customMetadata: { originalName: file.name },
  });
  return Response.json({ key, url: `/api/media/${encodeURIComponent(key)}`, name: file.name });
}
