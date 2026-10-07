package com.lubrcapp.lubrcapp.core.store

import androidx.lifecycle.ViewModel
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn

/**
 * Repository + UseCase layer service.
 *
 * Provides a clean abstraction over data sources:
 * - Local (Room) - primary source of truth
 * - Remote (Retrofit) - sync source
 * - Cache (DataStore, SharedPreferences)
 *
 * All repository calls return Flow for reactive updates.
 */
abstract class StoreService<T : ViewModel> {
    protected abstract val repository: Repository

    fun <R> getFlow(useCase: (T) -> Flow<R>): Flow<R> {
        return useCase(this as T)
    }

    fun <R> getStateIn(
        useCase: (T) -> Flow<R>,
        scope: CoroutineScope,
        started: SharingStarted = SharingStarted.WhileSubscribed(5000),
        initialValue: R
    ): StateFlow<R> {
        return useCase(this as T).stateIn(scope, started, initialValue)
    }
}

interface Repository {
    fun <T> observe(key: String): kotlinx.coroutines.flow.Flow<T>
    suspend fun insert(key: String, value: Any)
    suspend fun update(key: String, value: Any)
    suspend fun delete(key: String)
    suspend fun clear()
}

interface UseCase<in T : Any, out R> {
    suspend operator fun invoke(param: T): R
    fun getFlow(param: T): kotlinx.coroutines.flow.Flow<R>
}

/**
 * Common repository implementations for each domain.
 */
sealed class DomainRepository {
    data class AuthRepository(val authLocal: AuthLocalRepository, val authRemote: AuthRemoteRepository) : DomainRepository()
    data class BusinessRepository(val businessLocal: BusinessLocalRepository, val businessRemote: BusinessRemoteRepository) : DomainRepository()
    data class UserRepository(val userLocal: UserLocalRepository, val userRemote: UserRemoteRepository) : DomainRepository()
    data class PartyRepository(val partyLocal: PartyLocalRepository, val partyRemote: PartyRemoteRepository) : DomainRepository()
    data class ItemRepository(val itemLocal: ItemLocalRepository, val itemRemote: ItemRemoteRepository) : DomainRepository()
    data class InventoryRepository(val inventoryLocal: InventoryLocalRepository, val inventoryRemote: InventoryRemoteRepository) : DomainRepository()
    data class SalesRepository(val salesLocal: SalesLocalRepository, val salesRemote: SalesRemoteRepository) : DomainRepository()
    data class PurchaseRepository(val purchaseLocal: PurchaseLocalRepository, val purchaseRemote: PurchaseRemoteRepository) : DomainRepository()
    data class PaymentRepository(val paymentLocal: PaymentLocalRepository, val paymentRemote: PaymentRemoteRepository) : DomainRepository()
    data class AccountingRepository(val accountingLocal: AccountingLocalRepository, val accountingRemote: AccountingRemoteRepository) : DomainRepository()
}

interface AuthLocalRepository
interface AuthRemoteRepository
interface BusinessLocalRepository
interface BusinessRemoteRepository
interface UserLocalRepository
interface UserRemoteRepository
interface PartyLocalRepository
interface PartyRemoteRepository
interface ItemLocalRepository
interface ItemRemoteRepository
interface InventoryLocalRepository
interface InventoryRemoteRepository
interface SalesLocalRepository
interface SalesRemoteRepository
interface PurchaseLocalRepository
interface PurchaseRemoteRepository
interface PaymentLocalRepository
interface PaymentRemoteRepository
interface AccountingLocalRepository
interface AccountingRemoteRepository

