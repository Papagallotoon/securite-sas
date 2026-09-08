import nodemailer from "nodemailer";

const NOTIFY_TO = "mariusdumashome@gmail.com";
const CHANNEL_NAME = "Sécurité Maison";

// Best-effort notification email sent right after a video goes live —
// failure here must never fail the pipeline run itself (the video is
// already published by the time this runs), so every error is swallowed
// and just logged.
export async function sendPostedEmail({ article, videoUrl }) {
  const { GMAIL_USER, GMAIL_APP_PASSWORD } = process.env;
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
    console.log("GMAIL_USER/GMAIL_APP_PASSWORD not set — skipping notification email.");
    return;
  }

  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
    });

    await transporter.sendMail({
      from: GMAIL_USER,
      to: NOTIFY_TO,
      subject: `🎬 Nouvelle vidéo — ${CHANNEL_NAME} : ${article.title}`,
      text: `${article.title}\n\n${videoUrl}\n\nSujet : ${article.slug}`,
    });
    console.log(`Notification email sent to ${NOTIFY_TO}.`);
  } catch (err) {
    console.error("Failed to send notification email (non-fatal):", err.message);
  }
}
