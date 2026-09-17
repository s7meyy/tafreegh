import { NextResponse } from "next/server";

/** ردّ موحّد لمن لم يسجّل الدخول. */
export function unauthorized() {
  return NextResponse.json({ error: "سجّل الدخول أولًا." }, { status: 401 });
}

/** ردّ موحّد لمن سجّل الدخول لكن المورد ليس له. */
export function forbidden() {
  return NextResponse.json({ error: "لا صلاحية لك على هذا." }, { status: 403 });
}
