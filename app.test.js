import request from 'supertest';
import jwt from 'jsonwebtoken';

// Import the app from your Express server file
// Make sure your server file exports the Express app instead of calling app.listen()
// For example, in your server file, export `app` and call app.listen() in a separate file.
import app from './index.js';

// Mock Prisma client
jest.mock('@prisma/client', () => {
  const findFirstMock = jest.fn();
  const createMock = jest.fn();
  const updateMock = jest.fn();
  const membershipCreateMock = jest.fn();
  const gymOwnerFindUniqueMock = jest.fn();
  const gymOwnerFindManyMock = jest.fn();

  return {
    PrismaClient: jest.fn(() => ({
      customer: {
        findFirst: findFirstMock,
        create: createMock,
        update: updateMock,
      },
      membership: {
        create: membershipCreateMock,
      },
      gym_owner: {
        findUnique: gymOwnerFindUniqueMock,
        findMany: gymOwnerFindManyMock,
      },
    })),
  };
});

// Retrieve the mocked PrismaClient instance
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

describe('GET /get_profile', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test('should return 400 if gym_id or gym_owner_id is missing', async () => {
    const res = await request(app).get('/get_profile');
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('Missing details: gym_id or gym_owner_id');
  });

  test('should return customer details if found', async () => {
    // Arrange: Setup the mock to return a customer object
    prisma.customer.findFirst.mockResolvedValue({
      name: 'John Doe',
      phone_number: '1234567890',
    });

    // Act:
    const res = await request(app)
      .get('/get_profile')
      .query({ gym_id: 'gym1', gym_owner_id: '1' });

    // Assert:
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      name: 'John Doe',
      phone_number: '1234567890',
    });
    expect(prisma.customer.findFirst).toHaveBeenCalledWith({
      where: { gym_id: 'gym1', gym_owner_id: 1 },
      select: { name: true, phone_number: true },
    });
  });

  test('should return 404 if customer not found', async () => {
    prisma.customer.findFirst.mockResolvedValue(null);
    const res = await request(app)
      .get('/get_profile')
      .query({ gym_id: 'gym1', gym_owner_id: '1' });

    expect(res.statusCode).toBe(404);
    expect(res.body.error).toBe('Customer not found');
  });
});

describe('POST /membership', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  const membershipPayload = {
    gym_owner_id: 1,
    gym_id: 'gym1',
    phone_number: '1234567890',
    name: 'John Doe',
    duration: 3,
    start_date: '2025-04-01T00:00:00.000Z',
    payment_mode: 'cash',
    amount: '1000',
    workout_type: 'cardio',
    personal_training: true,
  };

  test('should return 400 if required fields are missing', async () => {
    const res = await request(app).post('/membership').send({});
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('Missing required fields');
  });

  test('should create a new customer and membership if customer does not exist', async () => {
    // Arrange: Customer not found initially.
    prisma.customer.findFirst.mockResolvedValue(null);
    prisma.customer.create.mockResolvedValue({
      id: 1,
      gym_owner_id: 1,
      name: 'John Doe',
      phone_number: '1234567890',
      status: true,
      gym_id: 'gym1',
      end_date: new Date('2025-07-01T00:00:00.000Z'),
    });
    prisma.membership.create.mockResolvedValue({
      id: 1,
      customer_id: 1,
      duration: 3,
      start_date: new Date('2025-04-01T00:00:00.000Z'),
      bill_date: new Date(), // dynamic value
      payment_mode: 'cash',
      amount: 1000,
      workout_type: 'cardio',
      personal_training: true,
    });

    // Act:
    const res = await request(app).post('/membership').send(membershipPayload);

    // Assert:
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(prisma.customer.findFirst).toHaveBeenCalledWith({
      where: { gym_owner_id: 1, gym_id: 'gym1' },
    });
    expect(prisma.customer.create).toHaveBeenCalled();
    expect(prisma.membership.create).toHaveBeenCalled();
  });

  test('should update customer and create membership if customer exists', async () => {
    // Arrange: Customer exists
    prisma.customer.findFirst.mockResolvedValue({
      id: 1,
      gym_owner_id: 1,
      name: 'John Doe',
      phone_number: '1234567890',
      status: false,
      gym_id: 'gym1',
      end_date: new Date('2025-05-01T00:00:00.000Z'),
    });
    prisma.customer.update.mockResolvedValue({
      id: 1,
      gym_owner_id: 1,
      name: 'John Doe',
      phone_number: '1234567890',
      status: true,
      gym_id: 'gym1',
      end_date: new Date('2025-07-01T00:00:00.000Z'),
    });
    prisma.membership.create.mockResolvedValue({
      id: 1,
      customer_id: 1,
      duration: 3,
      start_date: new Date('2025-04-01T00:00:00.000Z'),
      bill_date: new Date(), // dynamic value
      payment_mode: 'cash',
      amount: 1000,
      workout_type: 'cardio',
      personal_training: true,
    });

    // Act:
    const res = await request(app).post('/membership').send(membershipPayload);

    // Assert:
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(prisma.customer.findFirst).toHaveBeenCalled();
    expect(prisma.customer.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: expect.objectContaining({
        status: true,
      }),
    });
    expect(prisma.membership.create).toHaveBeenCalled();
  });
});

describe('GET /profile', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test('should return 400 if gym_id or gym_owner_id is missing', async () => {
    const res = await request(app).get('/profile');
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('gym_id and gym_owner_id required');
  });

  test('should return profile with membership transactions if customer exists', async () => {
    prisma.customer.findFirst.mockResolvedValue({
      name: 'John Doe',
      phone_number: '1234567890',
      status: true,
      end_date: new Date('2025-07-01T00:00:00.000Z'),
      memberships: [{ id: 1, duration: 3 }],
    });

    const res = await request(app)
      .get('/profile')
      .query({ gym_id: 'gym1', gym_owner_id: '1' });

    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('name', 'John Doe');
    expect(res.body).toHaveProperty('phone_number', '1234567890');
    expect(res.body).toHaveProperty('membership_transactions');
    expect(Array.isArray(res.body.membership_transactions)).toBe(true);
  });

  test('should return 404 if customer not found', async () => {
    prisma.customer.findFirst.mockResolvedValue(null);
    const res = await request(app)
      .get('/profile')
      .query({ gym_id: 'gym1', gym_owner_id: '1' });

    expect(res.statusCode).toBe(404);
    expect(res.body.error).toBe('Customer not found');
  });
});

describe('GET /view_all', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test('should return 400 if gym_owner_id is missing', async () => {
    const res = await request(app).get('/view_all');
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('gym_owner_id required');
  });

  test('should return list of customers for a valid gym_owner_id', async () => {
    prisma.gym_owner.findUnique.mockResolvedValue({
      id: 1,
      name: 'Owner One',
      customers: [
        { id: 1, name: 'Customer 1', phone_number: '1111111111' },
        { id: 2, name: 'Customer 2', phone_number: '2222222222' },
      ],
    });

    const res = await request(app)
      .get('/view_all')
      .query({ gym_owner_id: '1' });

    expect(res.statusCode).toBe(200);
    expect(res.body.length).toBe(2);
    expect(res.body[0]).toHaveProperty('name', 'Customer 1');
  });

  test('should return 404 if gym owner not found', async () => {
    prisma.gym_owner.findUnique.mockResolvedValue(null);
    const res = await request(app)
      .get('/view_all')
      .query({ gym_owner_id: '1' });

    expect(res.statusCode).toBe(404);
    expect(res.body.error).toBe('Gym owner not found');
  });
});

describe('POST /login', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test('should return 400 if phone_number or password is missing', async () => {
    const res = await request(app).post('/login').send({});
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('Phone number and password are required');
  });

  test('should return 401 for invalid credentials', async () => {
    prisma.gym_owner.findUnique.mockResolvedValue(null);
    const res = await request(app)
      .post('/login')
      .send({ phone_number: '1234567890', password: 'wrongpass' });
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toBe('Invalid credentials');
  });

  test('should return a JWT token for valid credentials', async () => {
    // Arrange: Setup a gym owner object with a matching password
    const gymOwner = { id: 1, phone_number: '1234567890', password: 'correctpass' };
    prisma.gym_owner.findUnique.mockResolvedValue(gymOwner);

    // Spy on jwt.sign to capture the token (or you could validate the token structure)
    const jwtSignSpy = jest.spyOn(jwt, 'sign').mockReturnValue('fake-jwt-token');

    const res = await request(app)
      .post('/login')
      .send({ phone_number: '1234567890', password: 'correctpass' });
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.token).toBe('fake-jwt-token');

    jwtSignSpy.mockRestore();
  });
});
