// server/index.js
require('dotenv').config();

const express   = require('express');
const cors      = require('cors');
const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');

const app       = express();
app.use(cors());
app.use(express.json());

const ai       = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// ── Route 1: Health check ─────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'RobotLearn server is running' });
});

// ── Route 2: AI Feedback + auto-unlock ───────────────────
app.post('/api/feedback', async (req, res) => {
  try {
    const { studentCode, taskSlug, studentId } = req.body;

    if (!taskSlug || !studentCode) {
      return res.status(400).json({ error: 'Missing taskSlug or studentCode in request body' });
    }

    // 1. Fetch the task spec and rubric from the database
    const { data: task, error: taskError } = await supabase
      .from('modules')
      .select('title, content, rubric, pass_threshold, level, order_index')
      .eq('slug', taskSlug)
      .single();

    if (taskError) {
      console.error('Supabase task lookup error:', taskError);
      return res.status(404).json({ error: 'Task not found', detail: taskError.message });
    }

    // 1b. Checklist topics (like the PDF build guide) bypass the AI entirely.
    //     The frontend sends this exact sentinel string when a student clicks
    //     "Mark as read" — there is no real code to review for these topics.
    if (studentCode === 'CHECKLIST_COMPLETE') {
      const feedback = {
        score: 100,
        summary: 'Checklist marked complete.',
        issues: [],
        strengths: [],
        nextSteps: [],
      };

      if (studentId) {
        const { error: progErr } = await supabase.from('progress').upsert({
          student_id: studentId, module_slug: taskSlug, status: 'complete'
        });
        if (progErr) console.error('Progress upsert failed (checklist):', progErr);

        const { data: nextTopic } = await supabase
          .from('modules')
          .select('slug')
          .eq('level', task.level)
          .eq('order_index', task.order_index + 1)
          .single();
        if (nextTopic) {
          await supabase.from('progress').upsert({
            student_id: studentId, module_slug: nextTopic.slug, status: 'available'
          });
          feedback.unlockedSlug = nextTopic.slug;
        }
      }

      return res.json(feedback);
    }

    // 1c. Rate-limit + duplicate-code check — protects API budget.
    //   - Cooldown: a student can submit real code at most once every 2 min.
    //   - Dedup: if the code is byte-for-byte identical to their last
    //     submission, return that same feedback again without paying for
    //     another AI call.
    const COOLDOWN_MS = 2 * 60 * 1000; // 2 minutes
    if (studentId) {
      const { data: lastSub } = await supabase
        .from('submissions')
        .select('code, ai_feedback, submitted_at')
        .eq('student_id', studentId)
        .eq('module_slug', taskSlug)
        .order('submitted_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (lastSub) {
        const elapsedMs = Date.now() - new Date(lastSub.submitted_at).getTime();

        if (elapsedMs < COOLDOWN_MS) {
          const remainingSeconds = Math.ceil((COOLDOWN_MS - elapsedMs) / 1000);
          return res.status(429).json({
            error: 'cooldown',
            message: `Please wait ${remainingSeconds}s before submitting again.`,
            remainingSeconds,
          });
        }

        if (lastSub.code.trim() === studentCode.trim()) {
          // Same code as last time — return identical feedback, no AI call.
          return res.json({ ...lastSub.ai_feedback, cached: true });
        }
      }
    }

    // 2. Call the Anthropic AI with a PyBricks-specific prompt
    let message;
    try {
      message = await ai.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: `You are a supportive PyBricks robotics coach for youth students aged 10-16.
          Only reference the PyBricks API (PrimeHub, Motor, DriveBase, ColorSensor).
          Never suggest RPi.GPIO, Arduino, or non-PyBricks libraries.
          Students in Level 1 use PyBricks Blockly — their code may be auto-generated Python.
          This is perfectly valid; review it the same way as hand-written code.
          Return ONLY a JSON object — no markdown, no preamble — with keys:
            score (0-100), summary (2 sentences, encouraging),
            issues (array of {lineNumber, problem, suggestion}),
            strengths (array of strings),
            nextSteps (array of max 3 strings).`,
        messages: [{
          role: 'user',
          content:
            `Task: ${task.title}\n` +
            `Goal: ${task.content.goal}\n` +
            `Rubric: ${JSON.stringify(task.rubric)}\n\n` +
            `Student code:\n${studentCode}`
        }]
      });
    } catch (anthropicErr) {
      // This logs the EXACT reason Anthropic rejected the request —
      // e.g. invalid API key, bad model name, malformed request.
      console.error('Anthropic API error:', anthropicErr.status, anthropicErr.message);
      console.error('Full error:', JSON.stringify(anthropicErr, null, 2));
      return res.status(502).json({
        error: 'AI service error',
        detail: anthropicErr.message || 'Unknown Anthropic API error'
      });
    }

    // 3. Parse the AI response
    let feedback;
    try {
      // Strip markdown code fences in case the model adds them despite instructions
      const rawText = message.content[0].text.trim()
        .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '');
      feedback = JSON.parse(rawText);
    } catch (parseErr) {
      console.error('Failed to parse AI response as JSON:', message.content[0].text);
      return res.status(502).json({
        error: 'AI returned an unexpected format',
        detail: parseErr.message
      });
    }

    // 4. Record progress for THIS task, and auto-unlock the next one if passed
    if (studentId) {
      const passed = feedback.score >= task.pass_threshold;

      // Always record an attempt on the current task. Mark it 'complete'
      // only once the student actually passes — this is what lets the
      // frontend remember "Mark as read" / completion state after logout.
      // NOTE: the progress table's CHECK constraint only allows
      // 'locked' | 'available' | 'in_progress' | 'complete' (no trailing 'd').
      const { error: progErr } = await supabase.from('progress').upsert({
        student_id: studentId,
        module_slug: taskSlug,
        status: passed ? 'complete' : 'available'
      });
      if (progErr) console.error('Progress upsert failed (current task):', progErr);

      if (passed) {
        const { data: nextTopic } = await supabase
          .from('modules')
          .select('slug')
          .eq('level', task.level)
          .eq('order_index', task.order_index + 1)
          .single();
        if (nextTopic) {
          await supabase.from('progress').upsert({
            student_id: studentId, module_slug: nextTopic.slug, status: 'available'
          });
          feedback.unlockedSlug = nextTopic.slug;
        }
      }
    }

    res.json(feedback);

  } catch (err) {
    // Catches anything unexpected so the client always gets a clear JSON error
    // instead of a cryptic status code or a hung request.
    console.error('Unexpected error in /api/feedback:', err);
    res.status(500).json({ error: 'Internal server error', detail: err.message });
  }
});

// ── Route 3: Save a submission ────────────────────────────
app.post('/api/submissions', async (req, res) => {
  const { studentId, moduleSlug, code, feedback } = req.body;
  const { error } = await supabase.from('submissions').insert({
    student_id: studentId, module_slug: moduleSlug,
    code, ai_feedback: feedback, score: feedback.score
  });
  if (error) return res.status(500).json({ error });
  res.json({ success: true });
});

// ── Route 4: Get all submissions (mentor view) ────────────
app.get('/api/submissions', async (req, res) => {
  const { data, error } = await supabase
    .from('submissions')
    .select('*, students(name, team)')
    .order('submitted_at', { ascending: false });
  if (error) return res.status(500).json({ error });
  res.json(data);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
