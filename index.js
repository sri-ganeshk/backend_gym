import express from 'express';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';

const app = express();
const prisma = new PrismaClient();

app.use(express.json());


/**
 * GET /get_profile
 * Request Query: gym_id, gym_owner_id
 * Response: { name, phone_number }
 */
app.get('/get_profile', async (req, res) => {
  const { gym_id, gym_owner_id } = req.query;
  if (!gym_id || !gym_owner_id) {
    return res.status(400).json({ error: 'Missing details: gym_id or gym_owner_id' });
  }

  try {
    const customer = await prisma.customer.findFirst({
      where: { 
        gym_id: gym_id.toString(),
        gym_owner_id: Number(gym_owner_id),
      },
      select: { name: true, phone_number: true },
    });

    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    return res.json(customer);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /membership
 * Request Body: {
 *   gym_owner_id, gym_id, phone_number, name, duration, start_date, payment_mode,
 *   amount, workout_type, personal_training
 * }
 * 
 * Creates a membership transaction for the customer.
 * If the customer does not exist, creates a new customer record with active status.
 * If the customer exists and the new start_date is before the current end_date, a warning is issued.
 */
app.post('/membership', async (req, res) => {
  const {
    gym_owner_id,
    gym_id,
    phone_number,
    name,
    duration,
    start_date,
    payment_mode,
    amount,
    workout_type,
    personal_training,
  } = req.body;

  if (
    !gym_owner_id ||
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

  try {
    // Find the customer based on gym_id and gym_owner_id
    let customer = await prisma.customer.findFirst({
      where: {
        gym_owner_id: Number(gym_owner_id),
        gym_id: gym_id.toString(),
      },
    });

    // Calculate the end_date based on the provided start_date and duration (in months)
    const newStartDate = new Date(start_date);
    const newEndDate = new Date(new Date(start_date).setMonth(new Date(start_date).getMonth() + Number(duration)));

    // If the customer exists, check if the new start date is before the current end_date
    if (customer && customer.end_date && newStartDate < new Date(customer.end_date)) {
      return res.status(400).json({ warning: 'New membership start date is before the current membership end date.' });
    }

    // Get bill_date in Asia/Kolkata timezone
    const bill_date = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));

    if (!customer) {
      // Create a new customer with active membership status and the calculated end_date
      customer = await prisma.customer.create({
        data: {
          gym_owner_id: Number(gym_owner_id),
          name,
          phone_number,
          status: true, // Active status
          gym_id: gym_id.toString(),
          end_date: newEndDate,
        },
      });
    } else {
      // Update customer's status and end_date when a new membership is added
      customer = await prisma.customer.update({
        where: { id: customer.id },
        data: {
          status: true,
          end_date: newEndDate,
        },
      });
    }

    // Create a membership transaction for the customer
    const membership = await prisma.membership.create({
      data: {
        customer_id: customer.id,
        duration: Number(duration),
        start_date: newStartDate,
        bill_date: bill_date,
        payment_mode,
        amount: parseFloat(amount),
        workout_type,
        personal_training,
      },
    });

    res.json({ success: true, membership });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});


/**
 * GET /profile
 * Request Query: gym_id, gym_owner_id
 * Response: { name, phone_number, status, end_date, membership_transactions }
 */
app.get('/profile', async (req, res) => {
  const { gym_id, gym_owner_id } = req.query;
  if (!gym_id || !gym_owner_id) {
    return res.status(400).json({ error: 'gym_id and gym_owner_id required' });
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
    return res.status(500).json({ error: error.message });
  }
});

/**
 * GET /view_all
 * Request Query: gym_owner_id
 * Response: List of customers (with their status, end_date, and membership transactions)
 */
app.get('/view_all', async (req, res) => {
  const { gym_owner_id } = req.query;
  if (!gym_owner_id) {
    return res.status(400).json({ error: 'gym_owner_id required' });
  }

  try {
    // Find the gym owner and return its associated customers
    const gymOwner = await prisma.gym_owner.findUnique({
      where: { id: Number(gym_owner_id) },
      include: { customers: true },
    });
    if (!gymOwner) {
      return res.status(404).json({ error: 'Gym owner not found' });
    }
    res.json(gymOwner.customers);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /login
 * Request Body: { phone_number, password }
 * 
 * Authenticates a gym owner.
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

  // Create a JWT without expiration (in production, add expiration and password hashing)
  const token = jwt.sign(
    { id: gymOwner.id },
    process.env.JWT_SECRET
  );

  return res.json({ success: true, token });
});

export default app;

// if (require.main === module) {
//     const PORT = process.env.PORT || 3000;
//     app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
// }


