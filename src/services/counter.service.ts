import { FilterQuery, UpdateQuery } from "mongoose";
import Counter, { ICounter } from "../model/counter.model";

class CounterService {
  /**
   * Find and update counter atomically
   * @param filter Query filter
   * @param update Update operations
   * @returns Updated counter document
   */
  async findOneAndUpdate(
    filter: FilterQuery<ICounter>,
    update: UpdateQuery<ICounter>
  ) {
    return Counter.findOneAndUpdate(filter, update, {
      new: true,
      upsert: true
    });
  }

  /**
   * Get current count value for a specific counter
   * @param counterName Name of the counter to get
   * @returns Current count value
   */
  async getCount(counterName: string) {
    const counter = await Counter.findOne({ name: counterName });
    return counter ? counter.count : 0;
  }
}

export default CounterService;