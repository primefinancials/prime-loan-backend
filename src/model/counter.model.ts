import mongoose from "mongoose";

export interface ICounter extends mongoose.Document {
  name: string;
  count: number;
}

const CounterSchema = new mongoose.Schema<ICounter>({
  name: {
    type: String,
    required: true,
    unique: true
  },
  count: {
    type: Number,
    required: true,
    default: 0
  }
});

export default mongoose.model<ICounter>("Counter", CounterSchema);