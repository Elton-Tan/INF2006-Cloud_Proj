import { useState, useEffect, useRef } from 'react';
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface Product {
  product_name: string;
  brand_name: string;
  avg_rating: number;
  loves_count: number;
  review_count: number;
}

interface RatingsData {
  statistics?: {
    total_reviews: number;
  };
  distribution?: Record<string, number>;
}

type FilterType = 'rating' | 'loves' | 'reviews';
type SortColumn = 'rank' | 'product' | 'brand' | 'rating' | 'loves' | 'reviews';
type SortDirection = 'asc' | 'desc';

const API_BASE = 'https://sa0cp2a3r8.execute-api.us-east-1.amazonaws.com/dev/api';

export default function TopProductsDashboard() {
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [displayedProducts, setDisplayedProducts] = useState<Product[]>([]);
  const [ratingsData, setRatingsData] = useState<RatingsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentFilter, setCurrentFilter] = useState<FilterType>('rating');
  const [searchTerm, setSearchTerm] = useState('');
  const [sortConfig, setSortConfig] = useState<{ column: SortColumn; direction: SortDirection }>({
    column: 'rank',
    direction: 'asc'
  });

  useEffect(() => {
    loadDashboard();
  }, []);

  useEffect(() => {
    handleSearch();
  }, [searchTerm, allProducts]);

  const loadDashboard = async () => {
    try {
      const healthResponse = await fetch(`${API_BASE}/health`);
      if (!healthResponse.ok) {
        throw new Error(`Health check failed: ${healthResponse.status}`);
      }

      const productsResponse = await fetch(`${API_BASE}/analytics/top-products?limit=50`);
      if (!productsResponse.ok) {
        throw new Error(`Products fetch failed: ${productsResponse.status}`);
      }
      const productsData = await productsResponse.json();

      const ratingsResponse = await fetch(`${API_BASE}/analytics/ratings`);
      const ratings = await ratingsResponse.json();

      setAllProducts(productsData.data || []);
      setDisplayedProducts(productsData.data || []);
      setRatingsData(ratings);
      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setLoading(false);
    }
  };

  const filterProducts = (type: FilterType) => {
    setCurrentFilter(type);
    const sorted = [...allProducts];
    
    if (type === 'rating') {
      sorted.sort((a, b) => b.avg_rating - a.avg_rating);
    } else if (type === 'loves') {
      sorted.sort((a, b) => b.loves_count - a.loves_count);
    } else if (type === 'reviews') {
      sorted.sort((a, b) => b.review_count - a.review_count);
    }
    
    setDisplayedProducts(sorted);
    setSortConfig({ column: 'rank', direction: 'asc' });
  };

  const handleSearch = () => {
    if (searchTerm === '') {
      setDisplayedProducts([...allProducts]);
    } else {
      const filtered = allProducts.filter(product => {
        const name = product.product_name.toLowerCase();
        const brand = product.brand_name.toLowerCase();
        return name.includes(searchTerm.toLowerCase()) || brand.includes(searchTerm.toLowerCase());
      });
      setDisplayedProducts(filtered);
    }
  };

  const sortTable = (column: SortColumn) => {
    const direction = sortConfig.column === column && sortConfig.direction === 'asc' ? 'desc' : 'asc';
    setSortConfig({ column, direction });

    const sorted = [...displayedProducts].sort((a, b) => {
      let aVal: any, bVal: any;

      switch(column) {
        case 'rank':
          aVal = allProducts.indexOf(a);
          bVal = allProducts.indexOf(b);
          break;
        case 'product':
          aVal = a.product_name.toLowerCase();
          bVal = b.product_name.toLowerCase();
          break;
        case 'brand':
          aVal = a.brand_name.toLowerCase();
          bVal = b.brand_name.toLowerCase();
          break;
        case 'rating':
          aVal = a.avg_rating;
          bVal = b.avg_rating;
          break;
        case 'loves':
          aVal = a.loves_count;
          bVal = b.loves_count;
          break;
        case 'reviews':
          aVal = a.review_count;
          bVal = b.review_count;
          break;
      }

      if (direction === 'asc') {
        return aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
      } else {
        return aVal < bVal ? 1 : aVal > bVal ? -1 : 0;
      }
    });

    setDisplayedProducts(sorted);
  };

  const renderStars = (rating: number) => {
    const fullStars = Math.floor(rating);
    const emptyStars = 5 - fullStars;
    return (
      <div className="flex justify-center gap-1 mt-2">
        {[...Array(fullStars)].map((_, i) => <span key={`full-${i}`} className="text-yellow-500">★</span>)}
        {[...Array(emptyStars)].map((_, i) => <span key={`empty-${i}`} className="text-gray-300">★</span>)}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-gradient-to-br from-purple-600 to-purple-800 flex flex-col items-center justify-center">
        <div className="w-20 h-20 border-8 border-white/30 border-t-white rounded-full animate-spin mb-5"></div>
        <div className="text-white text-2xl font-semibold">Loading Dashboard...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-600 to-purple-800 p-8">
        <div className="max-w-2xl mx-auto bg-white/95 rounded-3xl shadow-2xl p-10 text-center mt-24">
          <h2 className="text-3xl font-bold text-red-500 mb-5">⚠️ Connection Error</h2>
          <p className="text-gray-700">{error}</p>
        </div>
      </div>
    );
  }

  const avgRating = allProducts.reduce((sum, p) => sum + p.avg_rating, 0) / allProducts.length;
  const totalLoves = allProducts.reduce((sum, p) => sum + p.loves_count, 0);
  const totalReviews = ratingsData?.statistics?.total_reviews || 0;

  const chartData = displayedProducts.slice(0, 15).map((p, i) => ({
    name: `#${i + 1}`,
    rating: p.avg_rating,
    loves: p.loves_count / 1000,
    product: p.product_name
  }));

  const pieData = ratingsData?.distribution ? 
    Object.entries(ratingsData.distribution).map(([key, value]) => ({
      name: key,
      value: value
    })) : [];

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-600 to-purple-800 p-8">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-10 text-white">
          <h1 className="text-5xl font-extrabold mb-3 drop-shadow-lg">🏆 Top Products Performance</h1>
          <p className="text-lg text-white/90">Discover the highest-rated beauty products with the most customer love</p>
        </div>

        {/* Filter Tabs */}
        <div className="bg-white/95 rounded-2xl shadow-xl p-6 mb-8 flex gap-4 items-center flex-wrap">
          <span className="font-semibold text-gray-800 text-sm">Sort by:</span>
          <button 
            onClick={() => filterProducts('rating')}
            className={`px-5 py-2 rounded-xl font-semibold text-sm transition-all ${
              currentFilter === 'rating' 
                ? 'bg-gradient-to-r from-purple-600 to-purple-800 text-white' 
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}>
            ⭐ Highest Rated
          </button>
          <button 
            onClick={() => filterProducts('loves')}
            className={`px-5 py-2 rounded-xl font-semibold text-sm transition-all ${
              currentFilter === 'loves' 
                ? 'bg-gradient-to-r from-purple-600 to-purple-800 text-white' 
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}>
            ❤️ Most Loved
          </button>
          <button 
            onClick={() => filterProducts('reviews')}
            className={`px-5 py-2 rounded-xl font-semibold text-sm transition-all ${
              currentFilter === 'reviews' 
                ? 'bg-gradient-to-r from-purple-600 to-purple-800 text-white' 
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}>
            💬 Most Reviewed
          </button>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <div className="bg-white/95 rounded-2xl shadow-xl p-8 text-center hover:transform hover:-translate-y-2 transition-all border-t-4 border-purple-600">
            <div className="text-4xl mb-4">🏆</div>
            <div className="text-4xl font-extrabold text-gray-800 mb-2">{allProducts.length}</div>
            <div className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Top Products</div>
          </div>
          <div className="bg-white/95 rounded-2xl shadow-xl p-8 text-center hover:transform hover:-translate-y-2 transition-all border-t-4 border-purple-600">
            <div className="text-4xl mb-4">⭐</div>
            <div className="text-4xl font-extrabold text-gray-800 mb-2">{avgRating.toFixed(2)}</div>
            <div className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Avg Rating</div>
          </div>
          <div className="bg-white/95 rounded-2xl shadow-xl p-8 text-center hover:transform hover:-translate-y-2 transition-all border-t-4 border-purple-600">
            <div className="text-4xl mb-4">❤️</div>
            <div className="text-4xl font-extrabold text-gray-800 mb-2">{totalLoves.toLocaleString()}</div>
            <div className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Total Loves</div>
          </div>
          <div className="bg-white/95 rounded-2xl shadow-xl p-8 text-center hover:transform hover:-translate-y-2 transition-all border-t-4 border-purple-600">
            <div className="text-4xl mb-4">💬</div>
            <div className="text-4xl font-extrabold text-gray-800 mb-2">{totalReviews.toLocaleString()}</div>
            <div className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Total Reviews</div>
          </div>
        </div>

        {/* Top Products Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
          {displayedProducts.slice(0, 9).map((product, index) => {
            const rankClass = index === 0 ? 'from-yellow-400 to-yellow-600' : 
                            index === 1 ? 'from-gray-300 to-gray-400' : 
                            index === 2 ? 'from-amber-600 to-amber-700' : 
                            'from-purple-600 to-purple-800';
            return (
              <div key={index} className="bg-white/95 rounded-2xl shadow-xl p-8 hover:transform hover:-translate-y-2 transition-all relative">
                <div className={`absolute top-5 right-5 w-12 h-12 bg-gradient-to-br ${rankClass} text-white rounded-full flex items-center justify-center text-lg font-extrabold shadow-lg`}>
                  #{index + 1}
                </div>
                <div className="text-lg font-bold text-gray-800 mb-2 pr-14 min-h-[60px]" title={product.product_name}>
                  {product.product_name.length > 60 ? product.product_name.substring(0, 60) + '...' : product.product_name}
                </div>
                <div className="text-sm text-gray-500 mb-5 font-semibold">{product.brand_name}</div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-gray-50 rounded-xl p-4 text-center">
                    <div className="text-2xl font-extrabold text-yellow-500 mb-1">{product.avg_rating.toFixed(1)}</div>
                    <div className="text-xs text-gray-500 uppercase tracking-wide font-semibold">Rating</div>
                    {renderStars(product.avg_rating)}
                  </div>
                  <div className="bg-gray-50 rounded-xl p-4 text-center">
                    <div className="text-2xl font-extrabold text-red-500 mb-1">{product.loves_count.toLocaleString()}</div>
                    <div className="text-xs text-gray-500 uppercase tracking-wide font-semibold">Loves</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Charts Section */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          <div className="lg:col-span-2 bg-white/95 rounded-2xl shadow-xl p-8">
            <div className="text-2xl font-bold text-gray-800 mb-1">Performance Comparison</div>
            <div className="text-sm text-gray-500 mb-6">Top 15 products by rating and customer engagement</div>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis yAxisId="left" />
                <YAxis yAxisId="right" orientation="right" />
                <Tooltip content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    return (
                      <div className="bg-white p-3 rounded-lg shadow-lg border">
                        <p className="font-semibold text-sm mb-1">{payload[0].payload.product.substring(0, 50)}</p>
                        <p className="text-sm">Rating: {payload[0].value}</p>
                        <p className="text-sm">Loves: {(payload[1].value * 1000).toLocaleString()}</p>
                      </div>
                    );
                  }
                  return null;
                }} />
                <Legend />
                <Bar yAxisId="left" dataKey="rating" fill="#667eea" name="Rating" radius={[8, 8, 0, 0]} />
                <Bar yAxisId="right" dataKey="loves" fill="#e74c3c" name="Loves (thousands)" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="bg-white/95 rounded-2xl shadow-xl p-8">
            <div className="text-2xl font-bold text-gray-800 mb-1">Rating Distribution</div>
            <div className="text-sm text-gray-500 mb-6">Quality metrics</div>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" innerRadius={60} outerRadius={100} dataKey="value" label>
                  {pieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={['#e74c3c', '#e67e22', '#f39c12', '#2ecc71', '#27ae60'][index % 5]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Leaderboard */}
        <div className="bg-white/95 rounded-2xl shadow-xl p-8">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
            <div>
              <div className="text-2xl font-bold text-gray-800 mb-1">Complete Leaderboard</div>
              <div className="text-sm text-gray-500">Click column headers to sort • Search to filter</div>
            </div>
            <div className="relative w-full md:w-80">
              <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400">🔍</span>
              <input 
                type="text" 
                placeholder="Search products or brands..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border-2 border-gray-200 rounded-xl focus:border-purple-600 focus:outline-none"
              />
            </div>
          </div>
          
          {displayedProducts.length === 0 ? (
            <div className="text-center py-10 text-gray-500">
              <div className="text-5xl mb-4">🔍</div>
              <p>No products found matching your search</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl">
              <table className="w-full">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    {['Rank', 'Product', 'Brand', 'Rating', 'Loves', 'Reviews'].map((header, i) => {
                      const column = ['rank', 'product', 'brand', 'rating', 'loves', 'reviews'][i] as SortColumn;
                      return (
                        <th 
                          key={header}
                          onClick={() => sortTable(column)}
                          className="px-4 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 hover:text-purple-600 transition-all select-none relative"
                        >
                          {header}
                          {sortConfig.column === column && (
                            <span className="ml-2">{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>
                          )}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {displayedProducts.map((product, index) => (
                    <tr key={index} className="border-b border-gray-100 hover:bg-gray-50 transition-all">
                      <td className="px-4 py-5">
                        <span className="inline-block bg-purple-100 text-purple-700 px-3 py-1 rounded-full text-sm font-bold">
                          #{allProducts.indexOf(product) + 1}
                        </span>
                      </td>
                      <td className="px-4 py-5 font-semibold text-gray-800 max-w-md">{product.product_name}</td>
                      <td className="px-4 py-5 text-gray-600">{product.brand_name}</td>
                      <td className="px-4 py-5">
                        <div className="flex items-center gap-3">
                          <span className="font-bold">{product.avg_rating.toFixed(1)}</span>
                          <div className="w-20 h-2 bg-gray-200 rounded-full overflow-hidden">
                            <div 
                              className="h-full bg-gradient-to-r from-purple-600 to-purple-800 rounded-full transition-all"
                              style={{ width: `${(product.avg_rating / 5) * 100}%` }}
                            ></div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-5">
                        <span className="inline-block bg-red-50 text-red-600 px-3 py-1 rounded-full text-sm font-bold">
                          ❤️ {product.loves_count.toLocaleString()}
                        </span>
                      </td>
                      <td className="px-4 py-5">
                        <span className="inline-block bg-blue-50 text-blue-600 px-3 py-1 rounded-full text-sm font-bold">
                          💬 {product.review_count.toLocaleString()}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}