package __PACKAGE_NAME__

import android.app.role.RoleManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Telephony
import android.util.Patterns
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager

class SmsReaderModule(context: ReactApplicationContext) :
  ReactContextBaseJavaModule(context), ActivityEventListener {

  private var roleRequestPromise: Promise? = null

  init {
    context.addActivityEventListener(this)
  }

  override fun getName() = "SmsReader"

  @ReactMethod
  fun getPersistedBlockedNumbers(userId: String, promise: Promise) {
    try {
      val numbers = reactApplicationContext
        .getSharedPreferences("call_screening", Context.MODE_PRIVATE)
        .getStringSet("blocked_numbers_$userId", emptySet())
        .orEmpty()
      val result = Arguments.createArray()
      numbers.sorted().forEach(result::pushString)
      promise.resolve(result)
    } catch (error: Exception) {
      promise.reject("BLOCKED_NUMBERS_READ_FAILED", "Não foi possível ler a lista de bloqueio local.", error)
    }
  }

  @ReactMethod
  fun updateBlockedNumbers(userId: String, numbers: ReadableArray, promise: Promise) {
    try {
      val blockedNumbers = buildSet {
        for (index in 0 until numbers.size()) {
          numbers.getString(index)
            ?.filter(Char::isDigit)
            ?.takeIf(String::isNotEmpty)
            ?.let(::add)
        }
      }

      reactApplicationContext
        .getSharedPreferences("call_screening", Context.MODE_PRIVATE)
        .edit()
        .putString("active_user_id", userId)
        .putStringSet("blocked_numbers_$userId", blockedNumbers)
        .apply()

      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject("BLOCKED_NUMBERS_UPDATE_FAILED", "Não foi possível atualizar a lista de bloqueio.", error)
    }
  }

  @ReactMethod
  fun isCallScreeningRoleHeld(promise: Promise) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
      promise.resolve(false)
      return
    }

    val roleManager = reactApplicationContext.getSystemService(RoleManager::class.java)
    promise.resolve(
      roleManager?.isRoleAvailable(RoleManager.ROLE_CALL_SCREENING) == true &&
        roleManager.isRoleHeld(RoleManager.ROLE_CALL_SCREENING),
    )
  }

  @ReactMethod
  fun requestCallScreeningRole(promise: Promise) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
      promise.resolve(false)
      return
    }

    val roleManager = reactApplicationContext.getSystemService(RoleManager::class.java)
    if (roleManager?.isRoleAvailable(RoleManager.ROLE_CALL_SCREENING) != true) {
      promise.resolve(false)
      return
    }

    if (roleManager.isRoleHeld(RoleManager.ROLE_CALL_SCREENING)) {
      promise.resolve(true)
      return
    }

    val activity = reactApplicationContext.currentActivity
    if (activity == null) {
      promise.reject("CALL_SCREENING_ACTIVITY_UNAVAILABLE", "Não foi possível abrir a solicitação de bloqueio.")
      return
    }

    if (roleRequestPromise != null) {
      promise.reject("CALL_SCREENING_REQUEST_IN_PROGRESS", "A solicitação de bloqueio já está aberta.")
      return
    }

    roleRequestPromise = promise
    try {
      activity.startActivityForResult(
        roleManager.createRequestRoleIntent(RoleManager.ROLE_CALL_SCREENING),
        CALL_SCREENING_ROLE_REQUEST,
      )
    } catch (error: Exception) {
      roleRequestPromise = null
      promise.reject("CALL_SCREENING_REQUEST_FAILED", "Não foi possível solicitar o bloqueio de chamadas.", error)
    }
  }

  override fun onActivityResult(
    activity: android.app.Activity,
    requestCode: Int,
    resultCode: Int,
    data: Intent?,
  ) {
    if (requestCode != CALL_SCREENING_ROLE_REQUEST) return

    val promise = roleRequestPromise ?: return
    roleRequestPromise = null

    val roleManager = reactApplicationContext.getSystemService(RoleManager::class.java)
    promise.resolve(roleManager?.isRoleHeld(RoleManager.ROLE_CALL_SCREENING) == true)
  }

  override fun onNewIntent(intent: Intent) = Unit

  @ReactMethod
  fun readMessagesWithLinks(afterTimestamp: Double, promise: Promise) {
    try {
      val cursor = reactApplicationContext.contentResolver.query(
        Telephony.Sms.Inbox.CONTENT_URI,
        arrayOf(
          Telephony.Sms._ID,
          Telephony.Sms.ADDRESS,
          Telephony.Sms.BODY,
          Telephony.Sms.DATE,
        ),
        "${Telephony.Sms.DATE} >= ?",
        arrayOf(afterTimestamp.toLong().toString()),
        "${Telephony.Sms.DATE} DESC",
      ) ?: throw IllegalStateException("Não foi possível consultar a caixa de entrada.")

      val messages = Arguments.createArray()
      cursor.use {
        val idIndex = it.getColumnIndexOrThrow(Telephony.Sms._ID)
        val senderIndex = it.getColumnIndexOrThrow(Telephony.Sms.ADDRESS)
        val bodyIndex = it.getColumnIndexOrThrow(Telephony.Sms.BODY)
        val dateIndex = it.getColumnIndexOrThrow(Telephony.Sms.DATE)

        while (it.moveToNext()) {
          val links = extractLinks(it.getString(bodyIndex).orEmpty())
          if (links.isEmpty()) continue

          val message = Arguments.createMap()
          message.putString("messageId", it.getString(idIndex))
          message.putString("sender", it.getString(senderIndex).orEmpty())
          message.putDouble("receivedAt", it.getLong(dateIndex).toDouble())

          val linkArray = Arguments.createArray()
          links.forEach(linkArray::pushString)
          message.putArray("links", linkArray)
          messages.pushMap(message)
        }
      }

      promise.resolve(messages)
    } catch (error: SecurityException) {
      promise.reject("SMS_PERMISSION_DENIED", "A permissão para ler SMS não foi concedida.", error)
    } catch (error: Exception) {
      promise.reject("SMS_READ_FAILED", "Não foi possível ler as mensagens recebidas.", error)
    }
  }

  private fun extractLinks(body: String): List<String> {
    val matcher = Patterns.WEB_URL.matcher(body)
    val links = linkedSetOf<String>()

    while (matcher.find()) {
      val link = matcher.group().trimEnd('.', ',', '!', '?', ':', ';', ')', ']', '}')
      if (link.isNotEmpty()) {
        links.add(
          if (link.startsWith("http://", ignoreCase = true) ||
            link.startsWith("https://", ignoreCase = true)
          ) {
            link
          } else {
            "https://$link"
          },
        )
      }
    }

    return links.toList()
  }

  private companion object {
    const val CALL_SCREENING_ROLE_REQUEST = 4821
  }
}

class SmsReaderPackage : ReactPackage {
  override fun createNativeModules(
    reactContext: ReactApplicationContext,
  ): List<NativeModule> = listOf(SmsReaderModule(reactContext))

  override fun createViewManagers(
    reactContext: ReactApplicationContext,
  ): List<ViewManager<*, *>> = emptyList()
}
