require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const path = require('path');
const { Pool } = require('pg');
const IntaSend = require('intasend-node');
const OpenAI = require('openai');

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

// CockroachDB connection
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
  ssl: { rejectUnauthorized: false }
});

// IntaSend setup
const intasend = new IntaSend(
  process.env.INTASEND_PUBLIC_KEY,
  process.env.INTASEND_PRIVATE_KEY,
  false // live mode
);

// OpenAI setup
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ---------------- Payments ----------------
app.post("/pay", async (req, res) => {
  try {
    const { amount, phone } = req.body;
    const response = await intasend.collection().mpesaStkPush({
      amount: amount,
      currency: "KES",
      phone_number: phone,
    });
    console.log("Payment response:", response);
    res.json({ success: true, response });
  } catch (err) {
    console.error("Payment error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---------------- Signup ----------------
app.post('/signup', async (req, res) => {
  const { username, email, password } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    await pool.query(
      'INSERT INTO users (username, email, password) VALUES ($1, $2, $3)',
      [username, email, hashedPassword]
    );
    res.status(201).json({ message: 'User created!' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

// ---------------- Login ----------------
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'User not found' });
    }

    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password);

    if (!match) {
      return res.status(400).json({ error: 'Invalid password' });
    }

    res.status(200).json({ message: `Welcome ${user.username}!` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

// ---------------- Add Recipient ----------------
app.post('/recipients', async (req, res) => {
  const { name, email, phone, address } = req.body;
  if (!name || !email || !phone || !address) {
    return res.status(400).json({ error: "All fields are required" });
  }
  try {
    await pool.query(
      'INSERT INTO recipients (name, email, phone, address) VALUES ($1, $2, $3, $4)',
      [name, email, phone, address]
    );
    res.status(201).json({ message: `Recipient ${name} registered successfully!` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error while registering recipient' });
  }
});

// ---------------- Fetch Foods ----------------
app.get('/foods', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM foods');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch foods' });
  }
});

// ---------------- Fetch Recipients ----------------
app.get('/recipients', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM recipients');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch recipients' });
  }
});

// ---------------- AI Food Matching (Debug Version) ----------------
async function computeAIMatches(foods, recipients) {
  const matches = [];

  for (const food of foods) {
    let bestMatch = null;
    let bestScore = -1;

    for (const recipient of recipients) {
      const prompt = `You are helping match surplus food to recipients.

Food: ${food.name}, quantity: ${food.quantity || "unknown"}, urgency: ${food.urgency || "unknown"}.
Recipient: ${recipient.name}, capacity: ${recipient.capacity || "unknown"}, location: ${recipient.address}.
Rate the suitability of this food donation to the recipient from 0 to 100, and respond with only the number.`;

      try {
        console.log(`Sending prompt to OpenAI:\n${prompt}`);

        const response = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: prompt }],
        });

        console.log("Raw OpenAI response:", response);

        let scoreText = response?.choices?.[0]?.message?.content || "0";
        console.log(`Score text received: "${scoreText}"`);

        const score = parseInt(scoreText.replace(/[^0-9]/g, ""), 10) || 0;
        console.log(`Parsed score: ${score}`);

        if (score > bestScore) {
          bestScore = score;
          bestMatch = {
            recipient: recipient.name,
            score,
            food: { name: food.name, quantity: food.quantity, urgency: food.urgency },
          };
        }
      } catch (err) {
        console.error(
          `OpenAI error for food "${food.name}" and recipient "${recipient.name}":`,
          err.response ? err.response.data : err
        );
      }
    }

    if (bestMatch) {
      console.log(`Best match for "${food.name}":`, bestMatch);
      matches.push(bestMatch);
    } else {
      console.log(`No match found for "${food.name}"`);
    }
  }

  console.log("All matches computed:", matches);
  return matches;
}

// AI Match Route with Debug
app.get("/ai-match", async (req, res) => {
  try {
    const foodsResult = await pool.query("SELECT * FROM foods");
    const recipientsResult = await pool.query("SELECT * FROM recipients");

    if (!foodsResult.rows.length || !recipientsResult.rows.length) {
      console.log("No foods or recipients available");
      return res.status(400).json({ error: "No foods or recipients available" });
    }

    const matches = await computeAIMatches(foodsResult.rows, recipientsResult.rows);
    res.json(matches);
  } catch (err) {
    console.error("AI matching route error:", err);
    res.status(500).json({ error: "AI matching failed" });
  }
});



// Start the server
app.listen(port, () => {
  console.log(`🚀 Server running on http://localhost:${port}`);
});





// ---------------- Payments ----------------
app.post("/pay", async (req, res) => {
  try {
    const { amount, phone } = req.body;

    // Call IntaSend API
    const response = await intasend.collection().mpesaStkPush({
      amount: amount,
      currency: "KES",
      phone_number: phone,
    });

    console.log("Payment response:", response);
    res.json({ success: true, response });
  } catch (err) {
    console.error("Payment error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});
