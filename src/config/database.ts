import mongoose from 'mongoose';

export const connectDB = async (): Promise<void> => {
  const conn = await mongoose.connect(process.env.MONGODB_URI as string);
  console.log(`MongoDB connected: ${conn.connection.host}`);
};
