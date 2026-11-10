package app.lubric.desktop.data.sale

import app.lubric.desktop.data.db.VehicleEntity

/**
 * Vehicle fields as typed on a form. [oilCapacity] is deliberately absent
 * here: the plan carries it separately, because null means "do not
 * touch/set" (customer-form variant) while non-null means "write it"
 * (sale variant).
 */
data class VehicleFormInput(
    val registration: String,
    val make: String = "",
    val model: String = "",
    val modelYear: String = "",
    val color: String = "",
    val condition: String = "",
)

sealed interface VehicleUpsertPlan {
    data class Update(
        val vehicleId: Long,
        val make: String,
        val model: String,
        val modelYear: String,
        val color: String,
        val condition: String,
        val oilCapacity: Double?,
    ) : VehicleUpsertPlan

    data class Insert(
        val customerId: Int,
        val registration: String,
        val make: String,
        val model: String,
        val modelYear: String,
        val color: String,
        val condition: String,
        val mileage: Int?,
        val oilCapacity: Double?,
    ) : VehicleUpsertPlan

    data object Skip : VehicleUpsertPlan
}

/**
 * Pure vehicle upsert decision, matching the web app: a blank registration
 * is never saved; an existing vehicle (matched by customer + registration)
 * is updated in place; otherwise a new vehicle is inserted. All string
 * fields are trimmed.
 */
object VehicleUpsert {
    fun plan(
        existing: VehicleEntity?,
        customerId: Int,
        input: VehicleFormInput,
        mileage: Int?,
        oilCapacity: Double?,
    ): VehicleUpsertPlan {
        if (input.registration.trim().isEmpty()) return VehicleUpsertPlan.Skip
        if (existing != null) {
            return VehicleUpsertPlan.Update(
                vehicleId = existing.id,
                make = input.make.trim(),
                model = input.model.trim(),
                modelYear = input.modelYear.trim(),
                color = input.color.trim(),
                condition = input.condition.trim(),
                oilCapacity = oilCapacity,
            )
        }
        return VehicleUpsertPlan.Insert(
            customerId = customerId,
            registration = input.registration.trim(),
            make = input.make.trim(),
            model = input.model.trim(),
            modelYear = input.modelYear.trim(),
            color = input.color.trim(),
            condition = input.condition.trim(),
            mileage = mileage,
            oilCapacity = oilCapacity,
        )
    }
}
