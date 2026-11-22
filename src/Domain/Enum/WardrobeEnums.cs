namespace Domain.Enum;

// E2–E7 enums (wardrobe, looks, plan, stylist, trips). Kept in their own file so the shared Enums.cs stays untouched.
// Season lives in Domain.Services.Ai (Spring, Summer, Autumn, Winter) and is reused everywhere.

/// <summary>Brief §4.3 chips: Üst, Alt, Elbise, Dış giyim, Ayakkabı, Çanta, Aksesuar, Plaj giyim, Kayak giyim.</summary>
public enum ItemCategory { Top, Bottom, Dress, Outerwear, Shoes, Bag, Accessory, Beachwear, Skiwear }

public enum OutfitSlot { Top, Bottom, Outerwear, Shoes, BagAccessory }

public enum Occasion { Office, Dinner, Weekend, Wedding, Travel, Sport }

public enum TripType { Business, Dinner, Sightseeing }

/// <summary>Detected = a piece found in a multi-item photo, waiting for the user's selection (its image is the plain crop; no image-model call yet).</summary>
public enum ItemDraftStatus { Uploaded, Processing, Ready, Failed, Detected }

/// <summary>
/// Single = a photo with one piece (or a manual entry); Outfit = the source photo of a draft group (the AI found two or more
/// pieces in it; kept as "outfit" on the wire); Piece = one piece found in such a photo (parentDraftId = the group).
/// </summary>
public enum ItemDraftKind { Single, Outfit, Piece }

/// <summary>Brief §6 garment.kaynak: fotoğraf / kütüphane / satın alım; Manual = entered by hand without a photo.</summary>
public enum ItemSource { Photo, Library, Purchase, Manual }

/// <summary>Phase 2 (second hand Jul 2027, rental Jan 2028). Phase 1 only ever stores None.</summary>
public enum ItemListingStatus { None, ForSale, ForRent, Sold, Rented }

/// <summary>Import = created from an outfit photo by "Kombinlerini içe aktar" (the photo is the look's cover).</summary>
public enum LookSource { User, Stylist, Edit, Builder, Import }

/// <summary>
/// AI flat-lay cover of a saved look (LookCoverEntity): Pending = queued for the look's current pieces · Ready = the image
/// is written · Failed = no image for these pieces (the app keeps its drawn cover; retried only when the pieces change).
/// </summary>
public enum LookCoverStatus { Pending, Ready, Failed }

/// <summary>
/// Outfit import photo: Pending = slot issued, not uploaded yet · Uploaded = queued · Detected = pieces found (stage A),
/// waiting for matching · Ready = matched and its look draft built · Failed = nothing usable (failure says why).
/// </summary>
public enum OutfitImportPhotoStatus { Pending, Uploaded, Detected, Ready, Failed }

/// <summary>Stored session state. The wire status (uploading / processing / ready / failed / committed) is derived from the photos.</summary>
public enum OutfitImportStatus { Open, Committed }

// WeatherCondition: StoreSocialEnums.cs (the provider's condition set).

/// <summary>Reasons a suggestion is disliked (screen 17 "Beğenmedim").</summary>
public enum DislikeReason { NotMyStyle, WrongOccasion, WrongWeather, ColorMismatch, WornTooOften, Other }

/// <summary>Why a look / packing list carries a placeholder for a piece the wardrobe lacks.</summary>
public enum MissingPieceReason { EmptySlot, Rain, Cold, NoShoes, Suggested }
