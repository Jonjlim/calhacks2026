import time

from council.contracts import Listing

NOW = int(time.time() * 1000)

POTTERY_LISTINGS = [
    Listing(title="Handmade Stoneware Pottery Mug, Speckled Glaze", source_url="https://example-shop.test/mug", price_minor=3400, price_status="observed", seller="Etsy", retrieved_at=NOW),
    Listing(title="Pottery Starter Kit for Beginners, Air Dry Clay Set", source_url="https://example-shop.test/kit", price_minor=2999, price_status="observed", seller="Amazon", retrieved_at=NOW),
    Listing(title="Electric Pottery Wheel 350W", source_url="https://example-shop.test/wheel", price_minor=15999, price_status="observed", seller="Walmart", retrieved_at=NOW),
    Listing(title="Pottery Glaze Sampler Set", source_url="https://example-shop.test/glaze", price_minor=None, price_status="unknown", retrieved_at=NOW),
]

MAYA = "Maya loves pottery and handmade crafts, wants to try a pottery class, already owns a beginner kit, and the budget is $80."
JUDGE = "Find a birthday gift for Maya. She loves pottery, has a beginner kit already, prefers handmade things, and our budget is $80."
