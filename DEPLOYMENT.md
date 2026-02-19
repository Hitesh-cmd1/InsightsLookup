# Deployment Guide

## Frontend Deployment (Vercel)

### Prerequisites
- Vercel account
- GitHub repository connected to Vercel

### Steps

1. **Push your code to GitHub**
   ```bash
   git add .
   git commit -m "Add Vercel configuration"
   git push origin main
   ```

2. **Import project to Vercel**
   - Go to [Vercel Dashboard](https://vercel.com/dashboard)
   - Click "Add New Project"
   - Import your GitHub repository
   - Select the `frontend` directory as the root directory

3. **Configure Build Settings**
   - **Framework Preset**: Create React App
   - **Root Directory**: `frontend`
   - **Build Command**: `npm run build`
   - **Output Directory**: `build`
   - **Install Command**: `npm install`

4. **Set Environment Variables**
   In Vercel's project settings, add the following environment variable:
   
   | Name | Value |
   |------|-------|
   | `REACT_APP_INSIGHTS_API_URL` | `https://insightslookup.onrender.com` |
   | `REACT_APP_MIXPANEL_TOKEN` | `your_mixpanel_project_token` |
   | `REACT_APP_MIXPANEL_API_HOST` | `https://api-js.mixpanel.com` (or `https://api-eu.mixpanel.com` for EU projects) |

5. **Deploy**
   - Click "Deploy"
   - Vercel will build and deploy your application

### Troubleshooting

#### "Invalid Host header" Error

This error can occur when:

1. **Backend (Render) rejects the request**
   - Ensure your backend on Render is running and accessible
   - Check that CORS is properly configured in `app.py` (already done)
   - Verify the backend URL is correct: `https://insightslookup.onrender.com`

2. **Environment variable not set**
   - Make sure `REACT_APP_INSIGHTS_API_URL` is set in Vercel's environment variables
   - Redeploy after adding environment variables

3. **Backend not deployed or sleeping (Render free tier)**
   - Render's free tier puts apps to sleep after inactivity
   - The first request may take 30-60 seconds to wake up
   - Consider upgrading to a paid plan for always-on service

#### CORS Issues

If you see CORS errors in the browser console:
- Check that your backend has the CORS headers (already configured in `app.py`)
- Verify the backend URL matches exactly (no trailing slashes)

#### Build Failures

If the build fails:
- Check the build logs in Vercel
- Ensure all dependencies are in `package.json`
- Try building locally first: `npm run build`

## Backend Deployment (Render)

Your backend is already deployed at: `https://insightslookup.onrender.com`

### Important Notes
- Render's free tier sleeps after 15 minutes of inactivity
- First request after sleep takes 30-60 seconds
- Consider upgrading for production use

### Updating Backend
1. Push changes to your GitHub repository
2. Render will automatically redeploy

## Testing Deployment

After deployment:
1. Visit your Vercel URL (e.g., `https://your-app.vercel.app`)
2. Try searching for an organization
3. Check browser console for any errors
4. Verify API calls are going to the correct backend URL

## Common Issues

### Backend URL Mismatch
- **Symptom**: API calls fail with 404 or network errors
- **Solution**: Verify `REACT_APP_INSIGHTS_API_URL` is set correctly in Vercel

### Render App Sleeping
- **Symptom**: First request takes very long or times out
- **Solution**: Wait 30-60 seconds for Render to wake up, or upgrade to paid tier

### Environment Variables Not Applied
- **Symptom**: App uses wrong backend URL
- **Solution**: Redeploy in Vercel after setting environment variables
