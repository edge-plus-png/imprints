import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";

export async function GET() {
  const filePath = path.join(
    process.cwd(),
    "public",
    ".well-known",
    "apple-developer-merchantid-domain-association"
  );

  try {
    const content = await readFile(filePath, "utf8");

    return new NextResponse(content, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch (error) {
    console.error("Apple Pay domain association file missing", error);

    return NextResponse.json(
      { error: "Apple Pay verification file not found" },
      { status: 404 }
    );
  }
}
