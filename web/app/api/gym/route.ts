import { NextRequest, NextResponse } from "next/server";
import { logged } from "@/lib/log";
import { publicMessage } from "@/lib/errors";
import { requireAuth } from "@/lib/guard";
import { updateFile } from "@/lib/store";
import { todayISO } from "@/lib/date";
import { checkEdit, editEquipment, setExerciseStatus, type EquipmentEdit } from "@/lib/gym";

export const dynamic = "force-dynamic";

/**
 * Change the home gym or the exercise rotation from the Gym tab.
 *
 *   exercise  {id, status: active | inactive}   in or out of rotation
 *   nuobell / fixed_dumbbells / kettlebells / adjustable_kb / list_add / list_remove
 *                                               equipment edits (see lib/gym.ts)
 *
 * The coach reads both files every morning, so a change shows up in tomorrow's
 * brief; days the app builds itself follow it at once. No history is touched.
 */
async function handlePOST(req: NextRequest) {
  const denied = requireAuth(req);
  if (denied) return denied;
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    if (body.action === "exercise") {
      const id = String(body.id ?? "");
      const status = body.status;
      if (!/^[a-z0-9_]+$/.test(id)) return NextResponse.json({ error: "unknown exercise" }, { status: 400 });
      if (status !== "active" && status !== "inactive") {
        return NextResponse.json({ error: "status must be active or inactive" }, { status: 400 });
      }
      let missing = false;
      await updateFile(
        "library/exercises.yaml",
        (raw) => {
          if (!raw) {
            missing = true;
            return null;
          }
          try {
            return setExerciseStatus(raw, id, status);
          } catch {
            missing = true;
            return null;
          }
        },
        `${status === "inactive" ? "Deactivate" : "Activate"} ${id}\n\nFrom the Gym tab. History is untouched.`
      );
      if (missing) return NextResponse.json({ error: "no such exercise" }, { status: 404 });
      return NextResponse.json({ ok: true, id, status });
    }

    const edit = body as unknown as EquipmentEdit;
    const problem = checkEdit(edit);
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });
    let failure: string | null = null;
    await updateFile(
      "gym/equipment.yaml",
      (raw) => {
        if (!raw) {
          failure = "gym/equipment.yaml not found";
          return null;
        }
        try {
          return editEquipment(raw, edit, todayISO());
        } catch (err) {
          failure = err instanceof Error ? err.message : String(err);
          return null;
        }
      },
      `Gym: ${edit.action}${"item" in edit ? ` ${edit.item}` : ""}\n\nFrom the Gym tab.`
    );
    if (failure) return NextResponse.json({ error: failure }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("gym failed", err);
    return NextResponse.json({ error: publicMessage(err) }, { status: 500 });
  }
}

export const POST = logged("gym", handlePOST);
