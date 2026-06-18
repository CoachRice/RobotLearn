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
  const { studentCode, taskSlug, studentId } = req.body;

  // 1. Fetch the task spec and rubric from the database
  const { data: task, error } = await supabase
    .from('modules')
    .select('title, content, rubric, pass_threshold, level, order_index')
    .eq('slug', taskSlug)
    .single();
  if (error) return res.status(404).json({ error: 'Task not found' });

  // 2. Call the Anthropic AI with a PyBricks-specific prompt
  const message = await ai.messages.create({
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

  // 3. Parse the AI response
  const feedback = JSON.parse(message.content[0].text);

  // 4. Auto-unlock the next topic if the student passed
  if (studentId && feedback.score >= task.pass_threshold) {
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

  res.json(feedback);
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
