const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");
const cors = require("cors");
const pdfParse = require("pdf-parse");
const sqlite3 = require("sqlite3").verbose();
const { GoogleGenerativeAI } = require("@google/generative-ai");

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const today = new Date();
const month = today.toLocaleString("default", { month: "long" });
const year = today.getFullYear();
const monthDir = `${month}-${year}`;

const uploadBaseDir = path.join(__dirname, "./file");

if (!fs.existsSync(uploadBaseDir)) {
  fs.mkdirSync(uploadBaseDir, { recursive: true });
  console.log(`Created base upload directory at ${uploadBaseDir}`);
}

const upload = multer({ dest: uploadBaseDir });

const db = new sqlite3.Database("tax_reply.db");

const port = process.env.PORT || 3000;

app.post(
  "/api/v1/upload-notice",
  upload.single("notice-file"),
  async (req, res) => {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    try {
      const buffer = fs.readFileSync(file.path);
      const parsedData = await pdfParse(buffer);
      const textContent = parsedData.text;

      // Generate prompt for Gemini API
      const prompt = `Clear any existing data. Based on the content ${textContent}, provide a JSON object with the following keys and their corresponding values, extracted from the text:

      - PAN (if available)
      - Date
      - DIN
      - Address
      - AssessmentYear
      - Sections`;

      // Call Gemini API
      const extractedData = await generateGeminiResponse(prompt);
      const cleanedData = extractedData.replace(/```json|```/g, "");

      const jsonData = JSON.parse(cleanedData);
      const { Address, PAN, AssessmentYear, DIN, Date, Sections } = jsonData;

      // Create PAN directory inside month-year directory
      const panDir = path.join(uploadBaseDir, `${monthDir}/${PAN}`);
      if (!fs.existsSync(panDir)) {
        fs.mkdirSync(panDir, { recursive: true });
        console.log(`Created PAN directory at ${panDir}`);
      }

      // Move the uploaded file to the PAN directory
      const newFilePath = path.join(panDir, file.originalname);
      fs.renameSync(file.path, newFilePath);
      const fileType = "notice";
      db.run(
        `INSERT INTO Notice (pan_number, date, din_number, address, sections, assessment_year, fileLocation, fileType) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          PAN,
          Date,
          DIN,
          Address,
          Sections,
          AssessmentYear,
          newFilePath,
          fileType,
        ],
        function (err) {
          if (err) {
            return res.status(400).json({ error: err.message });
          }
          res.status(200).json({
            success: true,
            message: "Notice file uploaded and data extracted successfully",
            data: {
              PAN,
              Date,
              DIN,
              Address,
              Sections,
              AssessmentYear,
              newFilePath,
              fileType,
            },
          });
        }
      );
    } catch (error) {
      console.log(error);
      res.status(400).json({ error: error.message });
    }
  }
);

app.get("/api/v1/notices", (req, res) => {
  db.all("SELECT * FROM Notice", [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.status(200).json({ notices: rows });
  });
});

// Delete a notice by ID
app.delete("/api/v1/notices/:id", (req, res) => {
  const noticeId = req.params.id;

  db.run(`DELETE FROM Notice WHERE id = ?`, noticeId, function (err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    if (this.changes === 0) {
      return res.status(404).json({ error: "Notice not found" });
    }

    res.status(200).json({ message: "Notice deleted successfully" });
  });
});

// delete all notices
app.delete("/api/v1/notices", (req, res) => {
  db.run(`DELETE FROM Notice`, function (err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    // Check if any rows were affected
    if (this.changes === 0) {
      return res.status(404).json({ error: "No notices found" });
    }

    res.status(200).json({ message: "All notices deleted successfully" });
  });
});

async function generateGeminiResponse(prompt) {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    return text;
  } catch (error) {
    console.error("Error generating response:", error);
    throw new Error("Error generating response");
  }
}

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
