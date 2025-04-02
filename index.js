import express from 'express';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { body, validationResult } from 'express-validator';
import { createClient } from 'redis';
import cors from 'cors';
import { initializeWhatsAppClient, getWhatsAppClient } from './whatsappClient.js';

const app = express();
const prisma = new PrismaClient();

// Middleware Setup
app.use(cors());
app.use(express.json());

// Set trust proxy to 1 (assuming a single proxy/load balancer)
app.set('trust proxy', 1);

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

// Apply JWT authentication middleware for all routes below
app.use(authenticateJWT);

/**
 * GET /get_profile
 * Request Query: gym_id
 * Response: { name, phone_number, end_date }
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
      select: { name: true, phone_number: true, end_date: true },
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
 * Creates a membership transaction and updates or creates a customer record.
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
        payment_details: payment_details || null,
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
 * Response: Customer details with memberships.
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
      gym_id: customer.gym_id,
      membership_transactions: customer.memberships,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /view_all
 * Response: List of all customers for the gym owner.
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
 * GET /expiring_memberships/:days
 * Response: List of active customers with memberships expiring within the specified days.
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
      select: { id: true, name: true, phone_number: true, end_date: true, gym_id: true },
    });

    res.json({
      count: expiringCustomers.length,
      members: expiringCustomers
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /account
 * Response: Gym owner account details.
 */
app.get('/account', async (req, res) => {
  const gym_owner_id = req.user.id;

  try {
    const gymOwner = await prisma.gym_owner.findUnique({
      where: { id: Number(gym_owner_id) },
      select: { name: true, phone_number: true, gym_name: true },
    });

    if (!gymOwner) {
      return res.status(404).json({ error: 'Gym owner not found' });
    }
    res.json(gymOwner);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ----------------------
// Redis & OTP Endpoints
// ----------------------

// Initialize Redis client (ensure REDIS_URL is correct in your environment)
const redisClient = createClient({ url: process.env.REDIS_URL });
redisClient.on('error', (err) => console.error('Redis Client Error', err));

// Rate limiter for OTP endpoints
const otpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes window
  max: 5, // limit each IP to 5 OTP requests per windowMs
  message: 'Too many OTP requests from this IP, please try again later'
});

// Middleware for input validation errors
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

/**
 * POST /request_phone_change
 * Sends an OTP to the gym owner's current phone number when a phone change is requested.
 */
app.post(
  '/request_phone_change',
  otpLimiter,
  body('new_phone_number').isMobilePhone('any').withMessage('Invalid phone number'),
  validate,
  async (req, res, next) => {
    const gym_owner_id = req.user.id;
    const { new_phone_number } = req.body;

    try {
      // Get current gym owner details
      const gymOwner = await prisma.gym_owner.findUnique({
        where: { id: Number(gym_owner_id) }
      });
      
      if (!gymOwner) {
        return res.status(404).json({ error: 'Gym owner not found' });
      }
      
      // Check if new phone number already exists for another user
      const existingUser = await prisma.gym_owner.findFirst({
        where: { 
          phone_number: new_phone_number,
          id: { not: Number(gym_owner_id) }
        }
      });
      
      if (existingUser) {
        return res.status(400).json({ error: 'Phone number already in use by another account' });
      }
  
      // Generate 6 digit OTP
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      const otpExpirySeconds = 10 * 60; // 10 minutes
  
      // Store OTP with gym owner ID and new phone number in Redis
      const otpData = JSON.stringify({ otp, new_phone_number });
      await redisClient.set(`otp:${gym_owner_id}`, otpData, { EX: otpExpirySeconds });
      
      // Send OTP via WhatsApp to the CURRENT phone number
      const waClient = getWhatsAppClient();
      const currentWaNumber = `91${gymOwner.phone_number}@s.whatsapp.net`;
  
      await waClient.sendMessage(currentWaNumber, { 
        text: `Your OTP for phone number change is: ${otp}. Please use it to verify your new phone number: ${new_phone_number}` 
      });
  
      res.json({ message: 'OTP sent to your current phone number for verification' });
    } catch (error) {
      console.error('Error requesting phone change', { error });
      next(error);
    }
  }
);

/**
 * PUT /update_phone_number
 * Verifies the OTP and updates the phone number.
 */
app.put(
  '/update_phone_number',
  otpLimiter,
  body('otp').isLength({ min: 6, max: 6 }).withMessage('OTP must be 6 digits'),
  validate,
  async (req, res, next) => {
    const gym_owner_id = req.user.id;
    const { otp } = req.body;
  
    try {
      // Get stored OTP data from Redis
      const otpDataRaw = await redisClient.get(`otp:${gym_owner_id}`);
      if (!otpDataRaw) {
        return res.status(400).json({ error: 'No pending phone number change request found or OTP expired' });
      }
  
      const otpData = JSON.parse(otpDataRaw);
      
      // Verify OTP
      if (otpData.otp !== otp) {
        return res.status(400).json({ error: 'Invalid OTP' });
      }
      
      // Update phone number
      const updatedGymOwner = await prisma.gym_owner.update({
        where: { id: Number(gym_owner_id) },
        data: { phone_number: otpData.new_phone_number },
      });
      
      // Clear OTP data from Redis
      await redisClient.del(`otp:${gym_owner_id}`);
      
      // Send confirmation to new number via WhatsApp
      const waClient = getWhatsAppClient();
      const newWaNumber = `91${otpData.new_phone_number}@s.whatsapp.net`;
      await waClient.sendMessage(newWaNumber, { 
        text: `Your phone number has been successfully updated in your gym owner account.` 
      });
  
      res.json(updatedGymOwner);
    } catch (error) {
      console.error('Error updating phone number', { error });
      next(error);
    }
  }
);

/**
 * PUT /account
 * Updates basic account details (name, gym_name).
 */
app.put(
  '/account',
  body('name').optional().isString().trim().escape(),
  body('gym_name').optional().isString().trim().escape(),
  validate,
  async (req, res, next) => {
    const gym_owner_id = req.user.id;
    const { name, gym_name } = req.body;
  
    try {
      const updatedGymOwner = await prisma.gym_owner.update({
        where: { id: Number(gym_owner_id) },
        data: { name, gym_name },
      });
      res.json(updatedGymOwner);
    } catch (error) {
      console.error('Error updating account details', { error });
      next(error);
    }
  }
);

/**
 * PUT /change_password
 * Changes the password for the gym owner.
 */
app.put('/change_password', async (req, res) => {
  const gym_owner_id = req.user.id;
  const { old_password, new_password } = req.body;

  try {
    const gymOwner = await prisma.gym_owner.findUnique({
      where: { id: Number(gym_owner_id) },
    });

    if (!gymOwner || gymOwner.password !== old_password) {
      return res.status(401).json({ error: 'Invalid old password' });
    }

    await prisma.gym_owner.update({
      where: { id: Number(gym_owner_id) },
      data: { password: new_password },
    });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /revenue
 * Returns total revenue for the current month.
 */
app.get('/revenue', async (req, res) => {
  const gym_owner_id = req.user.id;
 
  try {
    // Get start and end of the current month
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const endOfMonth = new Date(startOfMonth);
    endOfMonth.setMonth(endOfMonth.getMonth() + 1, 0); // Last day of the month
    endOfMonth.setHours(23, 59, 59, 999);

    // Get revenue for the current month
    const currentMonthRevenue = await prisma.membership.aggregate({
      where: {
        customer: {
          gym_owner_id: Number(gym_owner_id),
        },
        start_date: { gte: startOfMonth, lte: endOfMonth },
      },
      _sum: { amount: true },
    });

    res.json({
      total_revenue: currentMonthRevenue._sum.amount || 0,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /total_active_count
 * Returns total active customer count.
 */
app.get('/total_active_count', async (req, res) => {
  const gym_owner_id = req.user.id;

  try {
    const activeCount = await prisma.customer.count({
      where: {
        gym_owner_id: Number(gym_owner_id),
        status: true,
      },
    });

    res.json({ total_active_count: activeCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /expiring_memberships_count
 * Returns the count of expiring memberships in the next 7 days.
 */
app.get('/expiring_memberships_count/', async (req, res) => {
  const gym_owner_id = req.user.id;
  const days = 7;

  try {
    const now = new Date();
    const futureDate = new Date();
    futureDate.setDate(now.getDate() + days);

    const count = await prisma.customer.count({
      where: {
        gym_owner_id: Number(gym_owner_id),
        status: true,
        end_date: { gte: now, lte: futureDate },
      },
    });

    res.json({ count: count });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /revenue_details
 * Returns detailed revenue information grouped by month.
 */
app.get('/revenue_details', async (req, res) => {
  try {
    const transactions = await prisma.membership.findMany({
      where: {
        customer: {
          gym_owner_id: Number(req.user.id),
        },
      },
      include: {
        customer: {
          select: {
            id: true,
            gym_id: true,
            name: true,
            phone_number: true
          }
        }
      }
    });

    const revenueByMonth = {};

    transactions.forEach((transaction) => {
      const billDate = new Date(transaction.bill_date);
      const monthName = billDate.toLocaleString('default', { month: 'long' });
      const year = billDate.getFullYear();
      const key = `${monthName} ${year}`;

      if (!revenueByMonth[key]) {
        revenueByMonth[key] = { transactions: [], revenue: 0 };
      }
      
      const transactionWithGymId = {
        ...transaction,
        gym_id: transaction.customer.gym_id,
        customer_name: transaction.customer.name,
        customer_phone: transaction.customer.phone_number
      };
      
      revenueByMonth[key].transactions.push(transactionWithGymId);
      revenueByMonth[key].revenue += transaction.amount;
    });

    const result = Object.entries(revenueByMonth).map(([month, data]) => ({
      month,
      revenue: data.revenue,
      transactions: data.transactions,
    }));

    res.json(result);
  } catch (error) {
    console.error('Error fetching revenue:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ----------------------
// Start the Server
// ----------------------
async function startServer() {
  try {
    // Connect to Redis
    await redisClient.connect();
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
  } catch (err) {
    console.error('Failed to start server', err);
  }
}

startServer();
