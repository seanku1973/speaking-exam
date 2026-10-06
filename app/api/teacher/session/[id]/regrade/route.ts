import { NextRequest, NextResponse } from "next/server";
import { TEACHER_COOKIE_NAME, verifyTeacherToken } from "@/lib/teacherAuth";
import { createTeacherAdminSupabase } from "@/lib/teacherSupabase";
import type { Segment } from "@/lib/ai-audio";
import { gradeExamItemLevels, gradeExamReport } from "@/lib/examCalibratedGrading";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const token = request.cookies.get(TEACHER_COOKIE_NAME)?.value;
  if (!verifyTeacherToken(token)) return NextResponse.json({ ok:false, message:"Unauthorized" }, { status:401 });
  try {
    const { id: sessionId } = await context.params;
    const supabase = createTeacherAdminSupabase();
    const openai = process.env.OPENAI_API_KEY;
    const model = process.env.OPENAI_GRADING_MODEL || "gpt-5.6-luna";
    if (!openai) throw new Error("伺服器未設定 OPENAI_API_KEY。");

    const { data: result, error } = await supabase.from("exam_results").select("*").eq("session_id",sessionId).maybeSingle();
    if (error || !result) return NextResponse.json({ok:false,message:"找不到這次測驗的 AI 報告。"},{status:404});
    const transcript=String(result.transcript||"").trim();
    const segments=Array.isArray(result.student_segments)?(result.student_segments as Segment[]):[];
    const graded=await gradeExamReport({openai,model,blueprint:result.blueprint,transcript,segments});
    let itemLevels:any=null;
    try { itemLevels=await gradeExamItemLevels({openai,model,transcript,itemFeedback:graded.report.question_reviews,gradingJson:graded.gradingJson}); } catch(e){ console.error("Teacher item-level regrade failed:",e); }
    if (graded.total===0 && itemLevels && [itemLevels.part1,...(itemLevels.part2||[]),itemLevels.part3].some((x:any)=>Number(x?.level)>0)) {
      throw new Error("100 分制評分與逐題成績不一致，系統已阻止寫入異常 0 分。請再按一次重新評分。");
    }
    const history=Array.isArray(result.grading_json?.regrade_history)?[...result.grading_json.regrade_history]:[];
    history.push({total_score:result.total_score??null,content_score:result.content_score??null,organization_score:result.organization_score??null,grammar_score:result.grammar_score??null,vocabulary_score:result.vocabulary_score??null,fluency_score:result.fluency_score??null,report_version:result.report_version||null,saved_at:new Date().toISOString()});
    const gradingJson={...graded.gradingJson,...(itemLevels?{item_level_grades:itemLevels,item_level_grades_version:"exam-calibrated-phase14b"}:{}),regrade_history:history.slice(-10),last_regraded_at:new Date().toISOString(),regrade_source:"teacher_existing_recording"};
    const {error:saveError}=await supabase.from("exam_results").update({content_score:graded.content,organization_score:graded.organization,grammar_score:graded.grammar,vocabulary_score:graded.vocabulary,fluency_score:graded.fluency,total_score:graded.total,passed:graded.passed,feedback:graded.report.executive_summary,strengths:graded.report.strengths.join("\n"),weaknesses:graded.report.priority_improvements.join("\n"),item_feedback:graded.report.question_reviews,grading_json:gradingJson,openai_model:model,report_version:"organized-v6-exam-calibrated",graded_at:new Date().toISOString()}).eq("session_id",sessionId);
    if(saveError) throw new Error(`重新評分完成但儲存失敗：${saveError.message}`);
    await supabase.from("exam_sessions").update({status:"completed",grading_status:"completed",total_score:graded.total,updated_at:new Date().toISOString()}).eq("id",sessionId);
    return NextResponse.json({ok:true,previous_score:result.total_score??null,total_score:graded.total,passed:graded.passed});
  } catch(error) {
    return NextResponse.json({ok:false,message:error instanceof Error?error.message:"老師重新評分失敗。"},{status:500});
  }
}
