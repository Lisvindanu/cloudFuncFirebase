// File: functions/index.js
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onDocumentCreated, onDocumentUpdated, onDocumentDeleted } = require('firebase-functions/v2/firestore');
const { setGlobalOptions } = require('firebase-functions/v2');

// Initialize Firebase Admin
initializeApp();
const db = getFirestore();
const auth = getAuth();

// Set global options for all functions
setGlobalOptions({ 
    maxInstances: 10,
    region: 'us-central1'
});

// ============================================================================
// EXISTING AUTH FUNCTIONS
// ============================================================================

exports.generateCustomToken = onCall(async (request) => {
    const data = request.data;
    
    console.log('🔍 Raw request received');
    console.log('  - username:', data?.username);
    console.log('  - displayName:', data?.displayName);
    console.log('  - isRegistration:', data?.isRegistration);

    // Validate request data
    if (!data || typeof data !== 'object') {
        console.error('❌ Invalid or empty data payload received');
        throw new HttpsError('invalid-argument', 'Request data is missing or malformed.');
    }

    // Extract and validate username
    const rawUsername = data.username;
    const username = String(rawUsername || '').trim();
    const usernameLower = username.toLowerCase();
    const displayName = String(data.displayName || username).trim();
    const isRegistration = Boolean(data.isRegistration);

    console.log('📋 Processing data:');
    console.log('  - username:', username);
    console.log('  - usernameLower:', usernameLower);
    console.log('  - displayName:', displayName);
    console.log('  - isRegistration:', isRegistration);

    // Validate username
    if (username.length === 0) {
        console.error('❌ Username is empty');
        throw new HttpsError('invalid-argument', 'Username is required and cannot be empty.');
    }

    if (username.length < 3) {
        console.error('❌ Username too short');
        throw new HttpsError('invalid-argument', 'Username must be at least 3 characters long.');
    }

    if (username.length > 30) {
        console.error('❌ Username too long');
        throw new HttpsError('invalid-argument', 'Username must be no more than 30 characters long.');
    }

    try {
        let targetUserId;

        if (isRegistration) {
            // REGISTRATION - Check if username exists in users collection
            console.log(`🎭 Registration request for username: ${username}`);

            const existingUserQuery = await db.collection('users')
                .where('usernameLower', '==', usernameLower)
                .limit(1)
                .get();

            if (!existingUserQuery.empty) {
                console.warn(`❌ Username '${username}' already taken`);
                throw new HttpsError('already-exists', `Username '${username}' is already taken.`);
            }

            // Create new Firebase Auth user
            console.log(`🏗️ Creating new Firebase Auth user for: ${username}`);
            const userRecord = await auth.createUser({
                displayName: displayName,
            });

            targetUserId = userRecord.uid;
            console.log(`✅ Created Firebase Auth user: ${targetUserId}`);

            // Create user profile in users collection
            const userProfileData = {
                uid: targetUserId,
                userId: targetUserId,
                username: username,
                usernameLower: usernameLower,
                displayName: displayName,
                authType: 'username',
                bio: '',
                email: null,
                favoriteKonoSubaCharacter: '',
                favoriteQuote: '',
                profilePicture: null,
                profileVersion: 1,
                partyRole: 'Newbie Adventurer',
                chaosLevel: 1,
                chaosEntries: 0,
                chaosEntriesCount: 0,
                totalEntries: 0,
                dayStreak: 0,
                longestStreak: 0,
                streakDays: 0,
                achievements: [],
                supportGiven: 0,
                supportReceived: 0,
                totalSupportGiven: 0,
                totalSupportReceived: 0,
                totalSupportsGiven: 0,
                totalSupportsReceived: 0,
                isActive: true,
                isAnonymous: false,
                settings: {
                    notificationsEnabled: true,
                    konoSubaQuotesEnabled: true,
                    anonymousMode: false,
                    reminderTime: '20:00',
                    shareByDefault: false,
                    theme: 'system',
                    showChaosLevel: true
                },
                createdAt: new Date(),
                joinDate: new Date(),
                lastActiveAt: new Date(),
                lastLogin: new Date(),
                lastLoginDate: new Date()
            };

            await db.collection('users').doc(targetUserId).set(userProfileData);
            console.log(`✅ User profile created for: ${targetUserId}`);

        } else {
            // LOGIN - Find user in users collection
            console.log(`🏠 Login request for username: ${username}`);

            const userQuery = await db.collection('users')
                .where('usernameLower', '==', usernameLower)
                .limit(1)
                .get();

            if (userQuery.empty) {
                console.warn(`❌ Username '${username}' not found`);
                throw new HttpsError('not-found', `Username '${username}' not found.`);
            }

            const userDoc = userQuery.docs[0];
            targetUserId = userDoc.id;
            console.log(`✅ Found user: ${targetUserId} for username: ${username}`);

            // Update last login
            await userDoc.ref.update({
                lastActiveAt: new Date(),
                lastLogin: new Date(),
                lastLoginDate: new Date()
            });
            console.log(`✅ Updated last login for: ${targetUserId}`);
        }

        // Generate custom token
        console.log(`🎟️ Generating custom token for: ${targetUserId}`);
        const customToken = await auth.createCustomToken(targetUserId);
        console.log(`✅ Custom token generated for: ${targetUserId}`);

        return {
            customToken: customToken,
            userId: targetUserId
        };

    } catch (error) {
        console.error('❌ Error in generateCustomToken:', error.message || error);

        if (error instanceof HttpsError) {
            throw error;
        }

        throw new HttpsError(
            'internal', 
            'Failed to generate custom token due to an unexpected server error.', 
            error.message
        );
    }
});

// ============================================================================
// 🌍 AUTO SHARE TO COMMUNITY FUNCTIONS - NEW!
// ============================================================================

/**
 * Cloud Function: Auto-share chaos entries to community feed
 * Triggers when a new chaos_entry is created with shareToFeed: true
 */
exports.autoShareToCommunity = onDocumentCreated('users/{userId}/chaos_entries/{entryId}', async (event) => {
    try {
        const entryData = event.data?.data();
        const userId = event.params.userId;
        const entryId = event.params.entryId;

        if (!entryData) {
            console.log('❌ No entry data found');
            return;
        }

        console.log(`🔥 New chaos entry created: ${entryId} by user: ${userId}`);
        console.log(`   - Share to feed: ${entryData.shareToFeed}`);
        console.log(`   - Title: ${entryData.title}`);

        // Only process if shareToFeed is true
        if (!entryData.shareToFeed) {
            console.log('⏭️ Skipping - shareToFeed is false');
            return;
        }

        console.log('🌍 Processing share to community feed...');

        // Get user info for anonymous username generation
        const userDoc = await db.collection('users').doc(userId).get();
        let anonymousUsername = 'Anonymous Adventurer';
        let username = 'Anonymous';
        
        if (userDoc.exists) {
            const userData = userDoc.data();
            username = userData.username || 'Anonymous';
            
            // Generate anonymous username from display name or username
            const baseName = userData.displayName || userData.username || 'Adventurer';
            const cleanBaseName = baseName.split('_')[0]; // Remove existing suffix if any
            const randomSuffix = Math.floor(Math.random() * 9999);
            anonymousUsername = `${cleanBaseName}_${randomSuffix}`;
        }

        // Prepare community post data
        const communityPostData = {
            id: entryId, // Use same ID for linking
            chaosEntryId: entryId,
            userId: userId, // For moderation purposes (not displayed)
            username: username,
            anonymousUsername: anonymousUsername,
            title: entryData.title,
            content: entryData.content,
            description: entryData.content, // For compatibility
            chaosLevel: entryData.chaosLevel,
            mood: entryData.mood || 'unknown',
            tags: entryData.tags || [],
            miniWins: entryData.miniWins || [],
            isAnonymous: true, // Always anonymous in community
            createdAt: entryData.createdAt,
            supportCount: 0,
            twinCount: 0,
            isReported: false,
            isModerated: false,
            viewCount: 0
        };

        // Write to community_feed collection
        await db.collection('community_feed').doc(entryId).set(communityPostData);

        console.log(`✅ Successfully shared entry ${entryId} to community feed`);
        console.log(`   - Anonymous username: ${anonymousUsername}`);
        console.log(`   - Title: ${entryData.title}`);

    } catch (error) {
        console.error('❌ Error in autoShareToCommunity function:', error);
        // Don't throw error to avoid breaking the original entry creation
    }
});

/**
 * Cloud Function: Handle entry updates
 * If shareToFeed is toggled on later, share to community
 */
exports.handleShareToggle = onDocumentUpdated('users/{userId}/chaos_entries/{entryId}', async (event) => {
    try {
        const beforeData = event.data?.before.data();
        const afterData = event.data?.after.data();
        const userId = event.params.userId;
        const entryId = event.params.entryId;

        if (!beforeData || !afterData) {
            console.log('❌ Missing before/after data');
            return;
        }

        // Check if shareToFeed was toggled from false to true
        if (!beforeData.shareToFeed && afterData.shareToFeed) {
            console.log(`🔄 Share to community toggled ON for entry: ${entryId}`);
            
            // Follow same logic as onCreate
            const userDoc = await db.collection('users').doc(userId).get();
            let anonymousUsername = 'Anonymous Adventurer';
            let username = 'Anonymous';
            
            if (userDoc.exists) {
                const userData = userDoc.data();
                username = userData.username || 'Anonymous';
                const baseName = userData.displayName || userData.username || 'Adventurer';
                const cleanBaseName = baseName.split('_')[0];
                const randomSuffix = Math.floor(Math.random() * 9999);
                anonymousUsername = `${cleanBaseName}_${randomSuffix}`;
            }

            const communityPostData = {
                id: entryId,
                chaosEntryId: entryId,
                userId: userId,
                username: username,
                anonymousUsername: anonymousUsername,
                title: afterData.title,
                content: afterData.content,
                description: afterData.content,
                chaosLevel: afterData.chaosLevel,
                mood: afterData.mood || 'unknown',
                tags: afterData.tags || [],
                miniWins: afterData.miniWins || [],
                isAnonymous: true,
                createdAt: afterData.createdAt,
                supportCount: 0,
                twinCount: 0,
                isReported: false,
                isModerated: false,
                viewCount: 0
            };

            await db.collection('community_feed').doc(entryId).set(communityPostData);
            console.log(`✅ Entry ${entryId} shared to community after toggle`);
        }
        
        // Check if shareToFeed was toggled from true to false
        else if (beforeData.shareToFeed && !afterData.shareToFeed) {
            console.log(`🗑️ Share to community toggled OFF for entry: ${entryId}`);
            
            // Remove from community feed
            await db.collection('community_feed').doc(entryId).delete();
            console.log(`✅ Entry ${entryId} removed from community feed`);
        }

    } catch (error) {
        console.error('❌ Error in handleShareToggle function:', error);
    }
});

/**
 * Cloud Function: Clean up community posts when chaos entry is deleted
 */
exports.cleanupCommunityPost = onDocumentDeleted('users/{userId}/chaos_entries/{entryId}', async (event) => {
    try {
        const entryId = event.params.entryId;
        
        console.log(`🗑️ Chaos entry deleted: ${entryId}`);
        
        // Check if there's a corresponding community post
        const communityPostDoc = await db.collection('community_feed').doc(entryId).get();

        if (communityPostDoc.exists) {
            await communityPostDoc.ref.delete();
            console.log(`✅ Community post ${entryId} cleaned up`);
        } else {
            console.log(`ℹ️ No community post found for ${entryId}`);
        }

    } catch (error) {
        console.error('❌ Error in cleanupCommunityPost function:', error);
    }
});

// ============================================================================
// MIGRATION FUNCTIONS
// ============================================================================

exports.addUsernameLowerField = onCall(async (request) => {
    console.log('🔄 Starting usernameLower migration...');
    
    const usersRef = db.collection('users');
    const snapshot = await usersRef.get();

    const batch = db.batch();
    let updateCount = 0;

    snapshot.forEach(doc => {
        const userData = doc.data();
        if (userData.username && !userData.usernameLower) {
            const usernameLower = userData.username.toLowerCase();
            batch.update(doc.ref, { usernameLower: usernameLower });
            updateCount++;
        }
    });

    if (updateCount > 0) {
        await batch.commit();
        console.log(`✅ Migration complete. Updated ${updateCount} users.`);
    } else {
        console.log('📝 No users to migrate.');
    }

    return { status: 'Migration complete', updatedCount: updateCount };
});

/**
 * Manual migration function untuk existing chaos entries
 * Call this once to migrate existing entries yang punya shareToFeed: true
 */
exports.migrateToCommunityFeed = onCall(async (request) => {
    try {
        console.log('🚀 Starting migration of chaos entries to community feed...');

        let processedCount = 0;
        let sharedCount = 0;

        // Get all users
        const usersSnapshot = await db.collection('users').get();
        
        for (const userDoc of usersSnapshot.docs) {
            const userId = userDoc.id;
            const userData = userDoc.data();
            
            console.log(`👤 Processing user: ${userId} (${userData.username || 'Unknown'})`);

            // Get all chaos entries for this user
            const entriesSnapshot = await db
                .collection('users')
                .doc(userId)
                .collection('chaos_entries')
                .get();

            for (const entryDoc of entriesSnapshot.docs) {
                const entryId = entryDoc.id;
                const entryData = entryDoc.data();
                
                processedCount++;

                // Only migrate if shareToFeed is true
                if (entryData.shareToFeed === true) {
                    
                    // Check if already exists in community_feed
                    const existingCommunityPost = await db
                        .collection('community_feed')
                        .doc(entryId)
                        .get();

                    if (existingCommunityPost.exists) {
                        console.log(`⏭️ Entry ${entryId} already exists in community feed`);
                        continue;
                    }

                    // Generate anonymous username
                    const baseName = userData.displayName || userData.username || 'Adventurer';
                    const cleanBaseName = baseName.split('_')[0];
                    const randomSuffix = Math.floor(Math.random() * 9999);
                    const anonymousUsername = `${cleanBaseName}_${randomSuffix}`;

                    // Prepare community post data
                    const communityPostData = {
                        id: entryId,
                        chaosEntryId: entryId,
                        userId: userId,
                        username: userData.username || 'Anonymous',
                        anonymousUsername: anonymousUsername,
                        title: entryData.title,
                        content: entryData.content,
                        description: entryData.content,
                        chaosLevel: entryData.chaosLevel,
                        mood: entryData.mood || 'unknown',
                        tags: entryData.tags || [],
                        miniWins: entryData.miniWins || [],
                        isAnonymous: true,
                        createdAt: entryData.createdAt,
                        supportCount: 0,
                        twinCount: 0,
                        isReported: false,
                        isModerated: false,
                        viewCount: 0
                    };

                    // Write to community_feed
                    await db.collection('community_feed').doc(entryId).set(communityPostData);
                    
                    sharedCount++;
                    console.log(`✅ Shared entry ${entryId} to community as: ${anonymousUsername}`);
                }
            }
        }

        console.log('🎉 Migration completed!');
        console.log(`   Total entries processed: ${processedCount}`);
        console.log(`   Entries shared to community: ${sharedCount}`);

        return { 
            status: 'Migration complete', 
            processedCount: processedCount,
            sharedCount: sharedCount 
        };

    } catch (error) {
        console.error('❌ Migration failed:', error);
        throw new HttpsError('internal', 'Migration failed', error.message);
    }
});