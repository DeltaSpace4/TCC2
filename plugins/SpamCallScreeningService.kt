package __PACKAGE_NAME__

import android.telecom.Call
import android.telecom.CallScreeningService

class SpamCallScreeningService : CallScreeningService() {
  override fun onScreenCall(callDetails: Call.Details) {
    val isIncoming = callDetails.callDirection == Call.Details.DIRECTION_INCOMING
    val callerNumber = callDetails.handle?.schemeSpecificPart
      ?.filter(Char::isDigit)

    val preferences = getSharedPreferences("call_screening", MODE_PRIVATE)
    val activeUserId = preferences.getString("active_user_id", null)
    val blockedNumbers = activeUserId?.let {
      preferences.getStringSet("blocked_numbers_$it", emptySet())
    } ?: emptySet()

    val shouldBlock =
      isIncoming &&
        !callerNumber.isNullOrEmpty() &&
        blockedNumbers.any { blockedNumber ->
          callerNumber == blockedNumber ||
            (minOf(callerNumber.length, blockedNumber.length) >= 8 &&
              (callerNumber.endsWith(blockedNumber) ||
                blockedNumber.endsWith(callerNumber)))
        }

    val response = CallResponse.Builder()
      .setDisallowCall(shouldBlock)
      .setRejectCall(shouldBlock)
      .build()

    respondToCall(callDetails, response)
  }
}
