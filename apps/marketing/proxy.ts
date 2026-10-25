import { NextResponse, type NextRequest } from "next/server";

/**
 * `x-middleware-subrequest` is set by Next.js itself on its own internal
 * sub-requests and by nothing else. A visitor that sends it is trying the 2025
 * middleware-bypass exploit (it arrives with a made-up `Next-Action`), so the
 * request is refused here, before any page code runs. Current Next.js already
 * ignores the header; this keeps the refusal explicit and out of the error log.
 */
export function proxy(request: NextRequest) {
  if (request.headers.has("x-middleware-subrequest")) {
    return new NextResponse(null, { status: 400 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
