'use strict';

const readline = require('node:readline/promises');
const { stdin, stdout } = require('node:process');

/**
 * =========================
 * CONFIG
 * =========================
 */
const TOTAL_GAME_TIME_MS = 60_000;  // total time cap for the entire quiz
const TIME_PER_QUESTION_MS = 15_000; // time cap per question

const QUESTIONS = [
  {
    prompt: 'Which method converts a JSON string into a JavaScript object?',
    choices: ['JSON.stringify()', 'JSON.parse()', 'Object.toJSON()', 'JSON.object()'],
    answerIndex: 1,
    explanation: 'JSON.parse() turns JSON text into a JS object.'
  },
  {
    prompt: 'What does Array.prototype.map() return?',
    choices: ['A single value', 'A new array', 'The original array mutated', 'A boolean'],
    answerIndex: 1,
    explanation: 'map() returns a NEW array with transformed values.'
  },
  {
    prompt: 'Which keyword declares a block-scoped variable?',
    choices: ['var', 'let', 'scope', 'constantly'],
    answerIndex: 1,
    explanation: 'let (and const) are block-scoped; var is function-scoped.'
  },
  {
    prompt: 'What will `typeof null` return in JavaScript?',
    choices: ['null', 'object', 'undefined', 'boolean'],
    answerIndex: 1,
    explanation: '`typeof null` is a historical JS quirk — it returns "object".'
  },
  {
    prompt: 'Which is NOT a primitive type in JavaScript?',
    choices: ['string', 'number', 'object', 'boolean'],
    answerIndex: 2,
    explanation: 'object is not primitive; it’s a reference type.'
  }
];

/**
 * =========================
 * UTILS
 * =========================
 */

/**
 * Formats milliseconds into seconds (rounded up).
 */
function msToSeconds(ms) {
  return Math.max(0, Math.ceil(ms / 1000));
}

/**
 * Converts user input like "A" or "1" into a choice index.
 * Returns a number index or null if invalid.
 */
function parseChoice(input, numberOfChoices) {
  if (!input) return null;

  const trimmed = input.trim().toUpperCase();

  // Allow numeric input: 1..N
  const asNumber = Number(trimmed);
  if (Number.isInteger(asNumber) && asNumber >= 1 && asNumber <= numberOfChoices) {
    return asNumber - 1; // convert to 0-based index
  }

  // Allow letter input: A..(A+N-1)
  const letterCode = trimmed.charCodeAt(0);
  const A = 'A'.charCodeAt(0);
  const index = letterCode - A;

  if (index >= 0 && index < numberOfChoices) {
    return index;
  }

  return null;
}

/**
 * Ask a question with a timeout using AbortController (async timer requirement).
 * Returns { value, timedOut }.
 */
async function askWithTimeout(rl, query, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const value = await rl.question(query, { signal: controller.signal });
    clearTimeout(timer);
    return { value, timedOut: false };
  } catch (err) {
    clearTimeout(timer);
    // Aborted (timed out)
    return { value: null, timedOut: true };
  }
}

/**
 * Prints a clean question UI.
 */
function printQuestion(q, index, total, remainingMs) {
  console.log('\n' + '='.repeat(50));
  console.log(`Question ${index + 1} of ${total}   (Game time left: ${msToSeconds(remainingMs)}s)`);
  console.log('-'.repeat(50));
  console.log(q.prompt);

  q.choices.forEach((choice, i) => {
    const letter = String.fromCharCode('A'.charCodeAt(0) + i);
    console.log(`  ${letter}) ${choice}`);
  });

  console.log('-'.repeat(50));
  console.log(`You have ${msToSeconds(Math.min(TIME_PER_QUESTION_MS, remainingMs))}s to answer.`);
}

/**
 * =========================
 * GAME LOGIC (MODULAR)
 * =========================
 */

/**
 * Presents one question, validates input, and returns a result object.
 */
async function runSingleQuestion(rl, q, qIndex, totalQuestions, deadlineMs) {
  const start = Date.now();
  const remainingMs = deadlineMs - start;

  if (remainingMs <= 0) {
    return {
      question: q.prompt,
      correctAnswer: q.choices[q.answerIndex],
      userAnswer: null,
      correct: false,
      timedOut: true,
      reason: 'Game time expired before this question.',
      timeTakenMs: 0
    };
  }

  printQuestion(q, qIndex, totalQuestions, remainingMs);

  // Per-question time limit cannot exceed remaining game time
  const allowedMs = Math.min(TIME_PER_QUESTION_MS, remainingMs);

  // Ask once; if invalid input, allow retry as long as time remains
  while (true) {
    const timeLeft = Math.min(allowedMs - (Date.now() - start), deadlineMs - Date.now());
    if (timeLeft <= 0) {
      console.log('\n⏰ Time is up!');
      return {
        question: q.prompt,
        correctAnswer: q.choices[q.answerIndex],
        userAnswer: null,
        correct: false,
        timedOut: true,
        reason: 'Timed out answering this question.',
        timeTakenMs: Date.now() - start
      };
    }

    const { value, timedOut } = await askWithTimeout(
      rl,
      `Your answer (A-${String.fromCharCode('A'.charCodeAt(0) + q.choices.length - 1)} or 1-${q.choices.length}): `,
      timeLeft
    );

    if (timedOut) {
      console.log('\n⏰ Time is up!');
      return {
        question: q.prompt,
        correctAnswer: q.choices[q.answerIndex],
        userAnswer: null,
        correct: false,
        timedOut: true,
        reason: 'Timed out answering this question.',
        timeTakenMs: Date.now() - start
      };
    }

    const chosenIndex = parseChoice(value, q.choices.length);
    if (chosenIndex === null) {
      console.log(`❌ Invalid input. Please enter A-${String.fromCharCode('A'.charCodeAt(0) + q.choices.length - 1)} or 1-${q.choices.length}.`);
      continue; // retry while time remains
    }

    const userAnswer = q.choices[chosenIndex];
    const correct = chosenIndex === q.answerIndex;

    console.log(correct ? '✅ Correct!' : '❌ Incorrect.');
    console.log(`Correct answer: ${q.choices[q.answerIndex]}`);
    if (q.explanation) console.log(`Why: ${q.explanation}`);

    return {
      question: q.prompt,
      correctAnswer: q.choices[q.answerIndex],
      userAnswer,
      correct,
      timedOut: false,
      reason: correct ? 'Answered correctly.' : 'Answered incorrectly.',
      timeTakenMs: Date.now() - start
    };
  }
}

/**
 * Runs the full game.
 */
async function startGame() {
  const rl = readline.createInterface({ input: stdin, output: stdout });

  console.log('\n🎯 Welcome to Trivia CLI!');
  console.log(`You have ${msToSeconds(TOTAL_GAME_TIME_MS)} seconds total.`);
  console.log(`Each question has up to ${msToSeconds(TIME_PER_QUESTION_MS)} seconds.\n`);

  const { value: startInput } = await askWithTimeout(rl, 'Start the game? (Y/N): ', 20_000);
  const wantsToPlay = (startInput || '').trim().toUpperCase().startsWith('Y');

  if (!wantsToPlay) {
    console.log('Okay! Goodbye 👋');
    rl.close();
    return;
  }

  const deadlineMs = Date.now() + TOTAL_GAME_TIME_MS;
  const results = [];

  for (let i = 0; i < QUESTIONS.length; i++) {
    const remainingMs = deadlineMs - Date.now();
    if (remainingMs <= 0) {
      console.log('\n⏰ Game over — total time limit reached!');
      break;
    }

    const result = await runSingleQuestion(rl, QUESTIONS[i], i, QUESTIONS.length, deadlineMs);
    results.push(result);

    // If game time expired mid-flow, stop
    if (deadlineMs - Date.now() <= 0) {
      console.log('\n⏰ Game over — total time limit reached!');
      break;
    }
  }

  endGame(results);
  rl.close();
}

/**
 * End-of-game summary.
 * Uses array iteration methods (REQUIRED): reduce, filter, map
 */
function endGame(results) {
  console.log('\n' + '='.repeat(50));
  console.log('🏁 GAME OVER');
  console.log('='.repeat(50));

  const totalAnswered = results.length;

  // Array iteration method example: reduce()
  const score = results.reduce((acc, r) => acc + (r.correct ? 1 : 0), 0);
  const percent = totalAnswered === 0 ? 0 : Math.round((score / totalAnswered) * 100);

  console.log(`Score: ${score} / ${totalAnswered} (${percent}%)`);

  // Array iteration method example: filter() + map()
  const missed = results
    .filter(r => !r.correct)
    .map(r => ({
      question: r.question,
      yourAnswer: r.userAnswer ?? '(no answer)',
      correctAnswer: r.correctAnswer,
      reason: r.reason
    }));

  if (missed.length > 0) {
    console.log('\nReview (missed questions):');
    missed.forEach((m, idx) => {
      console.log(`\n${idx + 1}) ${m.question}`);
      console.log(`   Your answer: ${m.yourAnswer}`);
      console.log(`   Correct:     ${m.correctAnswer}`);
      console.log(`   Note:        ${m.reason}`);
    });
  } else {
    console.log('\n🎉 Perfect score! Nice work!');
  }

  console.log('\nThanks for playing!');
}

// Run the program
startGame();
