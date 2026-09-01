const dotenv = require('dotenv');
const nodemailer = require('nodemailer');

dotenv.config({ path: './.env' });

const smtpUser = process.env.SMTP_USER ? process.env.SMTP_USER.trim() : '';
const smtpPass = process.env.SMTP_PASS ? process.env.SMTP_PASS.replace(/\s+/g, '') : '';

console.log('Testing SMTP user:', smtpUser);

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: smtpUser, pass: smtpPass },
  tls: { rejectUnauthorized: false }
});

const mailOptions = {
  from: `"DermaCare Healthcare" <${smtpUser}>`,
  replyTo: smtpUser,
  to: 'ansarisarfraj76867@gmail.com',
  subject: 'Your DermaCare Verification Code',
  text: 'Hello,\n\nYour DermaCare account verification code is: 468050\n\nThis security code will expire in 10 minutes.',
  html: `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
      <h2 style="color: #0d9488; margin-top: 0;">DermaCare Healthcare</h2>
      <p style="font-size: 15px; color: #333333;">Your verification code is:</p>
      <div style="margin: 20px 0; text-align: center;">
        <span style="font-size: 30px; font-weight: bold; letter-spacing: 5px; color: #0d9488; background-color: #f0fdf4; padding: 10px 20px; border-radius: 6px; border: 1px solid #0d9488; display: inline-block;">
          468050
        </span>
      </div>
      <p style="font-size: 13px; color: #666666;">This security code is valid for 10 minutes.</p>
    </div>
  `,
  headers: {
    'X-Priority': '1',
    'X-MSMail-Priority': 'High',
    'Importance': 'High'
  }
};

transporter.sendMail(mailOptions)
  .then(info => console.log('✅ INBOX DISPATCH SUCCESS:', info.messageId))
  .catch(err => console.error('❌ DISPATCH ERROR:', err));
