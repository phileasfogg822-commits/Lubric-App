package app.lubric.desktop.ui.team

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.lubric.desktop.data.team.TeamRepository
import app.lubric.desktop.ui.common.ErrorText
import app.lubric.desktop.ui.common.LubricScreen
import kotlinx.coroutines.launch

/** Route string for the Team & Access screen (coordinator wires Nav.kt). */
const val TEAM_ROUTE = "team"

class TeamViewModel(
    private val teamRepository: TeamRepository,
) : ViewModel() {

    var members by mutableStateOf<List<TeamRepository.TeamMember>>(emptyList())
        private set
    var error by mutableStateOf<String?>(null)
        private set

    init {
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            members = try {
                teamRepository.teamMembers()
            } catch (e: Exception) {
                error = e.message
                emptyList()
            }
        }
    }
}

/**
 * Team & Access, read-only in this phase.
 *
 * Mirrors `src/modules/team/Team.tsx` (member card: name, email · role,
 * "Full access" badge for admin/owner, permission count with "can edit
 * bills" / "cannot edit bills" and "can delete bills"). The web screen's
 * Add/Edit member form and permission checkboxes are deliberately NOT
 * reproduced here — an admin changes members and access on the web app.
 * Phones are not listed here either: device management lives under Shop
 * Settings, as the survey notes (§7 row 16).
 */
@Composable
fun TeamScreen(viewModel: TeamViewModel, onBack: () -> Unit) {
    LubricScreen(title = "Team & Access", onBack = onBack) {
        Spacer(Modifier.height(12.dp))
        Text(
            "Who can use this shop and what each person can do. " +
                "Read-only here — ask an admin on the web app to add a " +
                "member or change someone's access.",
            style = MaterialTheme.typography.bodyMedium,
        )
        Spacer(Modifier.height(16.dp))
        ErrorText(viewModel.error)

        if (viewModel.members.isEmpty()) {
            Text("No members", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        for (member in viewModel.members) {
            val user = member.user
            Card(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                Column(Modifier.padding(12.dp)) {
                    Text(
                        user.fullName.ifBlank { user.email },
                        style = MaterialTheme.typography.titleMedium,
                    )
                    Text(
                        "${user.email} · ${user.role.replaceFirstChar { it.uppercase() }}",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(Modifier.height(4.dp))
                    if (member.hasFullAccess) {
                        Text(
                            "Full access",
                            color = MaterialTheme.colorScheme.primary,
                            style = MaterialTheme.typography.bodyMedium,
                        )
                    } else {
                        val keys = member.permissionKeys
                        Text(
                            if (keys.isEmpty()) "No permissions"
                            else "${keys.size} permission${if (keys.size == 1) "" else "s"}: " +
                                keys.joinToString(", "),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Text(
                            (if (member.canEditBills) "can edit bills" else "cannot edit bills") +
                                if (member.canDeleteBills) " · can delete bills" else "",
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                }
            }
        }
        Spacer(Modifier.height(16.dp))
    }
}
