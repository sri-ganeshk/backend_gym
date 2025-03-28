-- CreateTable
CREATE TABLE "gym_owner" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "phone_number" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "gym_name" TEXT NOT NULL,

    CONSTRAINT "gym_owner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer" (
    "id" SERIAL NOT NULL,
    "gym_id" TEXT NOT NULL,
    "gym_owner_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "phone_number" TEXT NOT NULL,
    "status" BOOLEAN NOT NULL DEFAULT false,
    "end_date" TIMESTAMP(3),

    CONSTRAINT "customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membership" (
    "id" SERIAL NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "transaction_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "duration" INTEGER NOT NULL,
    "start_date" TIMESTAMP(3) NOT NULL,
    "bill_date" TIMESTAMP(3) NOT NULL,
    "payment_mode" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "workout_type" TEXT NOT NULL,
    "personal_training" BOOLEAN NOT NULL,

    CONSTRAINT "membership_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "gym_owner_phone_number_key" ON "gym_owner"("phone_number");

-- CreateIndex
CREATE UNIQUE INDEX "gym_owner_email_key" ON "gym_owner"("email");

-- CreateIndex
CREATE UNIQUE INDEX "customer_gym_id_gym_owner_id_key" ON "customer"("gym_id", "gym_owner_id");

-- AddForeignKey
ALTER TABLE "customer" ADD CONSTRAINT "customer_gym_owner_id_fkey" FOREIGN KEY ("gym_owner_id") REFERENCES "gym_owner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership" ADD CONSTRAINT "membership_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
