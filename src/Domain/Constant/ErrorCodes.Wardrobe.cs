namespace Domain.Constant;

// E2–E7 codes (wardrobe, looks, plan, stylist, try-on, palette).
public static partial class ErrorCodes
{
    // Wardrobe
    public const string DraftNotReady = "draft_not_ready";
    public const string DraftReviewRequired = "draft_review_required";
    public const string DraftNotFound = "draft_not_found";
    public const string DraftNotFailed = "draft_not_failed";
    public const string DraftIsOutfitSource = "draft_is_outfit_source";
    /// <summary>Select: the draft is not a draft group whose pieces wait for the user's choice.</summary>
    public const string DraftNotGroup = "draft_not_group";
    /// <summary>Select: a draft id that is not one of the group's pieces.</summary>
    public const string DraftNotInGroup = "draft_not_in_group";
    public const string CategoryRequired = "category_required";
    public const string ColorRequired = "color_required";
    public const string ColorUnknown = "color_unknown";
    public const string FabricUnknown = "fabric_unknown";
    public const string SeasonRequired = "season_required";
    public const string SubcategoryInvalid = "subcategory_invalid";
    public const string FabricTextTooLong = "fabric_text_too_long";
    public const string ColorHexInvalid = "color_hex_invalid";
    public const string LibraryItemNotFound = "library_item_not_found";
    public const string ProductNotFound = "product_not_found";
    public const string ItemIdTaken = "item_id_taken";

    // Looks
    public const string LookIdTaken = "look_id_taken";
    public const string LookMinPieces = "look_min_pieces";
    public const string SlotDuplicate = "slot_duplicate";
    public const string SlotSourceInvalid = "slot_source_invalid";
    public const string SlotCategoryMismatch = "slot_category_mismatch";
    public const string SlotItemNotFound = "slot_item_not_found";
    public const string SlotProductNotFound = "slot_product_not_found";
    public const string SlotPieceRepeated = "slot_piece_repeated";
    public const string DressClosesBottom = "dress_closes_bottom";

    // Plan / wear log
    public const string LookNotFound = "look_not_found";
    public const string ItemNotFound = "item_not_found";
    public const string WearLogEmpty = "wear_log_empty";

    // Stylist / trips
    public const string JobNotFound = "job_not_found";
    public const string JobNotCompleted = "job_not_completed";
    public const string SuggestionNotFound = "suggestion_not_found";
    public const string SuggestionStale = "suggestion_stale";
    public const string TripNotFound = "trip_not_found";
    /// <summary>422: the trip has no city id and its city name matches no place (geocoding).</summary>
    public const string TripCityNotFound = "trip_city_not_found";
    public const string TripIdTaken = "trip_id_taken";
    public const string RequestIdReused = "request_id_reused";

    // Try-on / palette
    public const string BodyPhotoRequired = "body_photo_required";
    public const string FacePhotoRequired = "face_photo_required";
    public const string TargetNotFound = "target_not_found";
    public const string TryOnTargetEmpty = "tryon_target_empty";
    public const string CreditQuoteChanged = "credit_quote_changed";
    public const string PaletteNotFound = "palette_not_found";
}
