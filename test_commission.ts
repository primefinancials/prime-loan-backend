import mongoose from 'mongoose';
import { InfluencerService } from './src/modules/influencer/influencer.service';
import User from './src/modules/users/user.model';
import { SettingsService } from './src/modules/admin/settings.service';

async function test() {
  await mongoose.connect('mongodb://127.0.0.1:27017/prime-finance');
  const settings = await SettingsService.getSettings();
  console.log("Settings influencer:", settings.influencer);

  // find any user
  const user = await User.findOne();
  if (user) {
    console.log("Testing commission for user:", user._id);
    await InfluencerService.recordCommissionForUser(user._id.toString(), 'loan', 50000, 'test_ref');
    console.log("Done");
  }
  process.exit(0);
}
test();
