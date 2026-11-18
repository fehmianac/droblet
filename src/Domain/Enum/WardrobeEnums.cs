namespace Domain.Enum;

// E2–E7 enums (wardrobe, looks, plan, stylist, trips). Kept in their own file so the shared Enums.cs stays untouched.
// Season lives in Domain.Services.Ai (Spring, Summer, Autumn, Winter) and is reused everywhere.

/// <summary>Brief §4.3 chips: Üst, Alt, Elbise, Dış giyim, Ayakkabı, Çanta, Aksesuar, Plaj giyim, Kayak giyim.</summary>
public enum ItemCategory { Top, Bottom, Dress, Outerwear, Shoes, Bag, Accessory, Beachwear, Skiwear }

public enum OutfitSlot { Top, Bottom, Outerwear, Shoes, BagAccessory }

public enum Occasion { Office, Dinner, Weekend, Wedding, Travel, Sport }

public enum TripType { Business, Dinner, Sightseeing }

public enum ItemDraftStatus { Uploaded, Processing, Ready, Failed }

/// <summary>Single = one garment photo; Outfit = "Kombin fotoğrafından parçaları ayır" source photo; Piece = a piece cut out of an Outfit draft.</summary>
public enum ItemDraftKind { Single, Outfit, Piece }

/// <summary>Brief §6 garment.kaynak: fotoğraf / kütüphane / satın alım.</summary>
public enum ItemSource { Photo, Library, Purchase }

/// <summary>Phase 2 (second hand Jul 2027, rental Jan 2028). Phase 1 only ever stores None.</summary>
public enum ItemListingStatus { None, ForSale, ForRent, Sold, Rented }

public enum LookSource { User, Stylist, Edit, Builder }

// WeatherCondition: StoreSocialEnums.cs (the provider's condition set).

/// <summary>Reasons a suggestion is disliked (screen 17 "Beğenmedim").</summary>
public enum DislikeReason { NotMyStyle, WrongOccasion, WrongWeather, ColorMismatch, WornTooOften, Other }

/// <summary>Why a look / packing list carries a placeholder for a piece the wardrobe lacks.</summary>
public enum MissingPieceReason { EmptySlot, Rain, Cold, NoShoes, Suggested }
