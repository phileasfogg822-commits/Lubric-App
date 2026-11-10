package app.lubric.desktop

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.navigation.compose.rememberNavController
import app.lubric.desktop.di.AppContainer
import app.lubric.desktop.ui.navigation.LubricNavHost
import app.lubric.desktop.ui.navigation.Routes

/**
 * Entry point. Uses the single [AppContainer] owned by [LubricApplication]
 * (so the WorkManager factory and the UI share one repository instance),
 * restores the saved session, then hosts the navigation graph. Nothing is
 * shown until the restore finishes, so the start destination is never
 * guessed from a not-yet-loaded session (a restored session must not flash
 * the login screen).
 */
class MainActivity : ComponentActivity() {

    private val container: AppContainer
        get() = (application as LubricApplication).container

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                LubricApp(container)
            }
        }
    }
}

@Composable
private fun LubricApp(container: AppContainer) {
    val navController = rememberNavController()
    val session by container.authRepository.session.collectAsState()
    val deviceToken by container.syncRepository.deviceToken.collectAsState(initial = null)
    var restored by remember { mutableStateOf(false) }
    var periodicStarted by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        try {
            container.authRepository.loadSession()
        } finally {
            restored = true
        }
    }

    // Periodic sync starts once a session exists and only once; the
    // repository itself is expected to guard repeat starts as well.
    LaunchedEffect(session) {
        if (session != null && !periodicStarted) {
            periodicStarted = true
            container.syncRepository.startPeriodicSync(applicationContext)
        }
    }

    if (!restored) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                CircularProgressIndicator()
                Spacer(Modifier.height(16.dp))
                Text("Loading…")
            }
        }
    } else {
        // Frozen on first composition: NavHost rebuilds its graph if this
        // value changes, so later auth transitions are driven by the state
        // observer inside LubricNavHost, not by a changing start destination.
        val startDestination = remember {
            when {
                session == null -> Routes.LOGIN
                deviceToken == null -> Routes.PAIRING
                else -> Routes.HOME
            }
        }
        LubricNavHost(
            navController = navController,
            container = container,
            startDestination = startDestination
        )
    }
}
