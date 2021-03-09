
import runRegistration from './registration/registration.playwright';
import runUploadingTests from './uploading/uploading.playwright';
import runTrackDetailsTest from './track_details/trackdetails.playwright';

//describe('Registration test', runRegistration);
//describe('Uploading Test', runUploadingTests);
describe('trackDetails Test', runTrackDetailsTest);
