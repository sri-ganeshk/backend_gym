import express from 'express';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { initializeWhatsAppClient, getWhatsAppClient } from './whatsappClient.js';
import cors from "cors"
const app = express();
const prisma = new PrismaClient();
app.use(cors())
app.use(express.json());

// Authentication middleware to verify JWT and attach gym_owner id to req.user
function authenticateJWT(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'Authorization header missing' });
  }

  // Expected format: "Bearer <token>"
  const token = authHeader.split(' ')[1];
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err || !decoded?.id) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = { id: decoded.id };
    next();
  });
}

// Initialize WhatsApp client
initializeWhatsAppClient()
  .then(() => console.log("WhatsApp client is ready."))
  .catch((error) => console.error("Failed to initialize WhatsApp client:", error));

/**
 * POST /login
 * Public route for gym owners to obtain a JWT token.
 */
app.post('/login', async (req, res) => {
  const { phone_number, password } = req.body;
  if (!phone_number || !password) {
    return res.status(400).json({ error: 'Phone number and password are required' });
  }

  // Find gym owner by phone number
  const gymOwner = await prisma.gym_owner.findUnique({
    where: { phone_number },
  });

  if (!gymOwner || gymOwner.password !== password) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // Create a JWT token (in production, consider adding expiration and hashing passwords)
  const token = jwt.sign({ id: gymOwner.id }, process.env.JWT_SECRET);
  return res.json({ success: true, token });
});


app.use(authenticateJWT)
/**
 * GET /get_profile
 * Request Query: gym_id
 * Response: { name, phone_number }
 * The gym_owner_id is obtained from the JWT token.
 */
app.get('/get_profile', async (req, res) => {
  const { gym_id } = req.query;
  const gym_owner_id = req.user.id;

  if (!gym_id) {
    return res.status(400).json({ error: 'Missing gym_id' });
  }

  try {
    const customer = await prisma.customer.findFirst({
      where: {
        gym_id: gym_id.toString(),
        gym_owner_id: Number(gym_owner_id),
      },
      select: { name: true, phone_number: true , end_date:true },
    });

    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    res.json(customer);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /membership
 * Request Body: {
 *   gym_id, phone_number, name, duration, start_date, payment_mode,
 *   amount, workout_type, personal_training
 * }
 * Creates a membership transaction and updates or creates a customer record.
 * The gym_owner_id is taken from the JWT token.
 */
app.post('/membership', async (req, res) => {
  const {
    gym_id,
    phone_number,
    name,
    duration,
    start_date,
    payment_mode,
    amount,
    workout_type,
    personal_training,
    payment_details, // New field for UPI/Card details
  } = req.body;
  const gym_owner_id = req.user.id;

  if (
    !gym_id ||
    !phone_number ||
    !name ||
    !duration ||
    !start_date ||
    !payment_mode ||
    !amount ||
    !workout_type ||
    personal_training === undefined
  ) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Validate payment details if payment mode is not cash
  if (payment_mode !== 'cash' && !payment_details) {
    return res.status(400).json({ error: 'Payment details required for UPI/Card payments' });
  }

  try {
    // Find customer based on gym_id and gym_owner_id
    let customer = await prisma.customer.findFirst({
      where: {
        gym_owner_id: Number(gym_owner_id),
        gym_id: gym_id.toString(),
      },
    });

    // Calculate new end_date based on start_date and duration (in months)
    const newStartDate = new Date(start_date);
    const newEndDate = new Date(new Date(start_date).setMonth(new Date(start_date).getMonth() + Number(duration)));

    // Get bill_date in Asia/Kolkata timezone
    const bill_date = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));

    if (!customer) {
      // Create new customer with active membership status
      customer = await prisma.customer.create({
        data: {
          gym_owner_id: Number(gym_owner_id),
          name,
          phone_number,
          status: true,
          gym_id: gym_id.toString(),
          end_date: newEndDate,
        },
      });
    } else {
      // Update existing customer's membership details
      customer = await prisma.customer.update({
        where: { id: customer.id },
        data: {
          status: true,
          end_date: newEndDate,
        },
      });
    }

    // Create membership transaction record with payment details
    const membership = await prisma.membership.create({
      data: {
        customer_id: customer.id,
        duration: Number(duration),
        start_date: newStartDate,
        bill_date: bill_date,
        payment_mode,
        payment_details: payment_details || null, // Store payment details if provided
        amount: parseFloat(amount),
        workout_type,
        personal_training,
      },
    });

    // Retrieve gym owner details for WhatsApp messaging
    const gymOwner = await prisma.gym_owner.findUnique({
      where: { id: Number(gym_owner_id) },
      select: { gym_name: true, phone_number: true, name: true },
    });

    try {
      // Get WhatsApp client and send messages to customer and gym owner
      const waClient = getWhatsAppClient();
      const waNumber = phone_number.includes('@s.whatsapp.net')
        ? phone_number
        : `91${phone_number}@s.whatsapp.net`;

      // Update customer message to include payment details
      const customer_message = `${gymOwner.gym_name.toUpperCase()}

DEAR : Madam / Sir

UR ADMIS NO : ${customer.gym_id}

LAST PAID DATE : ${bill_date.toLocaleDateString('en-GB')}
LAST PAID AMOUNT : ${amount} INR
PAYMENT MODE : ${payment_mode.toUpperCase()}
${payment_details ? `PAYMENT DETAILS : ${payment_details}` : ''}

THIS IS TO REMIND YOU
ABOUT THE COMPLETION OF UR "GYM FEE SUBSCRIPTION" HAS BEEN ENDED. 
HENCE, WE REMIND U TO RENEW YOUR "FEE SUBSCRIPTION" 
BE FIT FOR A GOOD HEALTHY TOMORROW.

THANK YOU  

${gymOwner.gym_name.toUpperCase()}
${gymOwner.phone_number}
${gymOwner.name}`;

      await waClient.sendMessage(waNumber, { text: customer_message });
      console.log(`Message sent to ${phone_number}`);

      // Update owner message to include payment details
      const owner_message = `Hi ${gymOwner.name},
A new membership has been created for ${customer.name} (${phone_number}).
Membership Details:
- Duration: ${duration} months
- Start Date: ${start_date}
- Payment Mode: ${payment_mode}
${payment_details ? `- Payment Details: ${payment_details}` : ''}
- Amount: ${amount} INR
- Personal Training: ${personal_training ? 'Yes' : 'No'}
- Bill Date: ${bill_date.toLocaleDateString('en-GB')}
- Customer End Date: ${customer.end_date.toLocaleDateString('en-GB')}
`;

      await waClient.sendMessage(`91${gymOwner.phone_number}@s.whatsapp.net`, { text: owner_message });
      console.log(`Message sent to gym owner ${gymOwner.phone_number}`);
    } catch (whatsappError) {
      console.error('Error sending WhatsApp message:', whatsappError);
    }

    res.json({ success: true, membership });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /profile
 * Request Query: gym_id
 * Response: { name, phone_number, status, end_date, membership_transactions }
 * The gym_owner_id is obtained from the JWT token.
 */
app.get('/profile', async (req, res) => {
  const { gym_id } = req.query;
  const gym_owner_id = req.user.id;

  if (!gym_id) {
    return res.status(400).json({ error: 'gym_id is required' });
  }

  try {
    const customer = await prisma.customer.findFirst({
      where: {
        gym_owner_id: Number(gym_owner_id),
        gym_id: gym_id.toString(),
      },
      include: { memberships: true },
    });

    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    res.json({
      name: customer.name,
      phone_number: customer.phone_number,
      status: customer.status,
      end_date: customer.end_date,
      membership_transactions: customer.memberships,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /view_all
 * Response: List of customers with their status, end_date, and membership transactions.
 * The gym_owner_id is obtained from the JWT token.
 */
app.get('/view_all', async (req, res) => {
  const gym_owner_id = req.user.id;

  try {
    const gymOwner = await prisma.gym_owner.findUnique({
      where: { id: Number(gym_owner_id) },
      include: { customers: true },
    });

    if (!gymOwner) {
      return res.status(404).json({ error: 'Gym owner not found' });
    }
    res.json(gymOwner.customers);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /expiring_memberships
 * Response: List of active customers with memberships expiring in the next 7 days.
 * The gym_owner_id is obtained from the JWT token.
 */
app.get('/expiring_memberships/:days', async (req, res) => {
  const gym_owner_id = req.user.id;
  const days = parseInt(req.params.days, 10) || 7;

  try {
    const now = new Date();
    const futureDate = new Date();
    futureDate.setDate(now.getDate() + days);

    const expiringCustomers = await prisma.customer.findMany({
      where: {
        gym_owner_id: Number(gym_owner_id),
        status: true,
        end_date: { gte: now, lte: futureDate },
      },
      select: { id: true, name: true, phone_number: true, end_date: true },
    });

    res.json({
      count: expiringCustomers.length,
      members: expiringCustomers
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));