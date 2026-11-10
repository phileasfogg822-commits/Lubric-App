package app.lubric.desktop.data.customer

import app.lubric.desktop.data.db.CustomerEntity
import app.lubric.desktop.data.db.LubricDatabase
import app.lubric.desktop.data.db.OrderEntity
import app.lubric.desktop.data.db.VehicleEntity
import app.lubric.desktop.data.sale.VehicleFormInput
import app.lubric.desktop.data.sale.VehicleUpsert
import app.lubric.desktop.data.sale.VehicleUpsertPlan
import java.time.Instant
import java.util.UUID

/**
 * Customer repository: list/search, detail aggregates, and save with the
 * optional vehicle captured alongside the customer.
 *
 * Mirrors the web app's Customers screen (`src/modules/customers/Customers.tsx`):
 * the vehicle is upserted per plate per customer, and a vehicle failure must
 * not undo a saved customer — it is reported back as [SaveCustomerResult.vehicleError]
 * instead.
 */
class CustomerRepository(private val db: LubricDatabase) {

    suspend fun customers(query: String): List<CustomerEntity> =
        if (query.isBlank()) db.customerDao().listAll()
        else db.customerDao().search(query.trim())

    suspend fun customerById(id: Long): CustomerEntity? = db.customerDao().getById(id)

    suspend fun vehicles(customerId: Int): List<VehicleEntity> =
        db.vehicleDao().byCustomer(customerId)

    /** The customer's most recent orders (DAO caps at 10). */
    suspend fun recentOrders(customerId: Int): List<OrderEntity> =
        db.orderDao().byCustomer(customerId)

    suspend fun lifetimeTotal(customerId: Int): Double =
        db.orderDao().lifetimeTotal(customerId)

    suspend fun completedCount(customerId: Int): Int =
        db.orderDao().completedCount(customerId)

    data class CustomerForm(
        val name: String,
        val phone: String,
        val customerType: String,
        val vehicle: VehicleFormInput,
    )

    data class SaveCustomerResult(val customerId: Long, val vehicleError: String?)

    suspend fun saveCustomer(
        form: CustomerForm,
        shopId: Int,
        existingId: Long? = null,
    ): SaveCustomerResult {
        val name = form.name.trim()
        require(name.isNotBlank()) { "Name required" }
        val now = Instant.now().toString()
        val customerId: Long
        if (existingId == null) {
            val uuid = UUID.randomUUID().toString()
            db.customerDao().upsert(
                CustomerEntity(
                    name = name,
                    phone = form.phone.trim(),
                    customerType = form.customerType,
                    creditBalance = 0.0,
                    uuid = uuid,
                    shopId = shopId,
                    updatedAt = now,
                ),
            )
            customerId = db.customerDao().getByUuid(uuid)!!.id
        } else {
            val existing = db.customerDao().getById(existingId)
                ?: throw IllegalArgumentException("Customer not found")
            db.customerDao().upsert(
                existing.copy(
                    name = name,
                    phone = form.phone.trim(),
                    customerType = form.customerType,
                    updatedAt = now,
                ),
            )
            customerId = existingId
        }

        // Vehicle (customer-form variant: no oil_capacity, no mileage).
        // The customer save stands even if the vehicle fails.
        var vehicleError: String? = null
        val registration = form.vehicle.registration.trim()
        if (registration.isNotEmpty()) {
            try {
                val customerIdInt = customerId.toInt()
                val existingVehicle = db.vehicleDao()
                    .getByCustomerAndRegistration(customerIdInt, registration)
                when (val plan = VehicleUpsert.plan(
                    existingVehicle,
                    customerIdInt,
                    form.vehicle,
                    mileage = null,
                    oilCapacity = null,
                )) {
                    VehicleUpsertPlan.Skip -> Unit
                    is VehicleUpsertPlan.Update -> {
                        val target = db.vehicleDao().getById(plan.vehicleId)
                            ?: existingVehicle
                            ?: throw IllegalArgumentException("Vehicle not found")
                        db.vehicleDao().upsert(
                            target.copy(
                                make = plan.make,
                                model = plan.model,
                                modelYear = plan.modelYear,
                                color = plan.color,
                                condition = plan.condition,
                                updatedAt = now,
                            ),
                        )
                    }
                    is VehicleUpsertPlan.Insert -> {
                        db.vehicleDao().upsert(
                            VehicleEntity(
                                customerId = plan.customerId,
                                registration = plan.registration,
                                make = plan.make,
                                model = plan.model,
                                modelYear = plan.modelYear,
                                color = plan.color,
                                condition = plan.condition,
                                uuid = UUID.randomUUID().toString(),
                                shopId = shopId,
                                updatedAt = now,
                            ),
                        )
                    }
                }
            } catch (e: Exception) {
                vehicleError = e.message
            }
        }
        return SaveCustomerResult(customerId, vehicleError)
    }
}
